/**
 * 派對模式's network check (the user 2026-10-19: check the phone can play online before anything else): online at
 * all, WebRTC there, the PeerJS signalling server reached, and a way out of the phone's network for the direct link
 * (a STUN address or the TURN relay). Each failure says plainly that this phone cannot play with others now.
 *
 * Issue #12 (2026-10-26): it gathers with the game's own servers (party-net ICE_SERVERS: the public STUN servers and
 * our TURN relay over UDP and TCP — a network that lets only TCP out still gets the relay). A network with no way
 * out at all (only this phone's own addresses: a proxy or VPN that drops UDP, say) no longer stops 派對模式: the
 * phone can still play with phones on the same Wi-Fi, and is told so. The failures mention a VPN / proxy (issue #8:
 * 「開了翻牆 VPN 就連不上，關了就能連」).
 */
import Peer from 'peerjs';
import { ICE_SERVERS } from './party-net';

export type NetCheck =
  | { ok: true; note?: string }
  | { ok: false; title: string; text: string; retry: boolean };

/** The same servers as the game's connections (party-net ICE_SERVERS). */
const ICE: RTCIceServer[] = ICE_SERVERS;

const within = <T,>(p: Promise<T>, ms: number, late: T) => Promise.race([p, new Promise<T>(r => setTimeout(() => r(late), ms))]);

/** The signalling server answers (a throwaway peer opens). */
function signalling(): Promise<boolean> {
  return within(new Promise<boolean>(resolve => {
    let p: Peer;
    try { p = new Peer({ debug: 0, config: { iceServers: ICE_SERVERS } }); } catch { resolve(false); return; }
    p.on('open', () => { resolve(true); p.destroy(); });
    p.on('error', () => { resolve(false); p.destroy(); });
    setTimeout(() => p.destroy(), 9000);
  }), 8000, false);
}

/** The kinds of ICE candidate this phone gathers: 'srflx' (STUN: reachable from outside) or 'relay' (TURN). */
async function candidates(): Promise<Set<string>> {
  const kinds = new Set<string>();
  let pc: RTCPeerConnection;
  try { pc = new RTCPeerConnection({ iceServers: ICE }); } catch { return kinds; }
  try {
    pc.createDataChannel('check');
    const done = new Promise<void>(resolve => {
      pc.onicecandidate = e => {
        if (!e.candidate) { resolve(); return; }
        const m = / typ (\w+)/.exec(e.candidate.candidate);
        if (m) kinds.add(m[1]);
        if (kinds.has('srflx') && kinds.has('relay')) resolve();
      };
    });
    await pc.setLocalDescription(await pc.createOffer());
    await within(done, 6000, undefined);
  } catch { /* nothing gathered */ } finally { pc.close(); }
  return kinds;
}

export async function checkNetwork(): Promise<NetCheck> {
  if (typeof navigator !== 'undefined' && navigator.onLine === false)
    return { ok: false, title: '沒有網路', text: '這支手機目前沒有連上網路，\n無法進行多人對戰。\n請開啟 Wi-Fi 或行動數據後再試一次。', retry: true };
  if (typeof RTCPeerConnection === 'undefined')
    return { ok: false, title: '不支援聯機', text: '這支手機（或系統版本）不支援聯機功能，\n無法進行多人對戰。\n請更新系統後再試。', retry: false };
  const [server, kinds] = await Promise.all([signalling(), candidates()]);
  return verdict(server, kinds);
}

const VPN = '如果開了翻牆 VPN 或代理，請先關掉再試\n（或在代理設定裡允許 UDP）。';

/** What the check says from what it found: the signalling server reached, the kinds of ICE candidate gathered. */
export function verdict(server: boolean, kinds: Set<string>): NetCheck {
  if (!server)
    return { ok: false, title: '連不上聯機伺服器', text: `這支手機現在連不上聯機伺服器，\n暫時無法進行多人對戰。\n${VPN}\n也請確認網路正常（公司、學校的網路可能擋住聯機），\n或換個網路再試。`, retry: true };
  if (kinds.has('srflx')) return { ok: true };
  if (kinds.has('relay')) return { ok: true, note: '你的網路只能透過轉送伺服器聯機，可能會比較慢' };
  // Only this phone's own addresses: the other phones on the same Wi-Fi can still be reached.
  if (kinds.has('host')) return { ok: true, note: `你的網路擋住了對外的聯機，現在只能和同一個 Wi-Fi 的人連線。\n${VPN}` };
  return { ok: false, title: '網路不支援聯機', text: `這支手機目前的網路擋住了手機之間的連線，\n無法進行多人對戰。\n${VPN}\n也可以換成其他 Wi-Fi 或行動數據再試。`, retry: true };
}
