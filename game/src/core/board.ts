/**
 * Board data parsed from the original map records (docs/rules/01 §1, 02 §0.3).
 * Records are read from their raw bytes: the field names in the extracted JSON swap land price and
 * per-level cost, so only the byte offsets confirmed in the rules documents are trusted here.
 */

export interface BoardNode {
  id: number;
  x: number;
  y: number;
  /** Up to four neighbour ids, 0 = empty slot (slot order matters for one-way bits). */
  adjacent: number[];
  /** 0 none, 2001.. land, 4001.. facility, 6001.. company, 8001 hospital, 8002 prison. */
  ref: number;
  aux: number;
  /** Stop event 0..16 (docs/rules/01 §7.2). */
  event: number;
  /** Bits 27-30: slot j may not be left towards (0x40000000 >> j). */
  oneWay: number;
  /** Bit 31: excluded from random placement. */
  noDrop: boolean;
}

export interface Land {
  id: number;
  x: number;
  y: number;
  /** Street name: lots with the same name form one street and merge their tolls. */
  name: string;
  /** +0x17 涨价/查封: high nibble days left, low nibble kind. */
  tmpState: number;
  chain: boolean;
  /** Player id + 1, 0 = nobody. */
  owner: number;
  level: number;
  facing: number;
  /** +0x1c land price. */
  price: number;
  /** +0x1e build cost per level. */
  perLevel: number;
  /** +0x20 toll by level 0..5. */
  tolls: number[];
  lastToll: number;
  /** Packed date, 0 = no limit. */
  expire: number;
}

export interface Facility {
  id: number;
  x: number;
  y: number;
  name: string;
  /** 0 公园, 1 旅馆, 2 购物中心, 3 加油站, 4 研究所 */
  type: number;
  owner: number;
  level: number;
  tmpState: number;
  labTool: number;
  labDays: number;
  /** +0x22 land price, also the cost of building. */
  price: number;
  /** +0x24 fee by level 0..5; fee[0] is also the upgrade cost. */
  fees: number[];
  lastFee: number;
  expire: number;
}

export interface Company {
  id: number;
  x: number;
  y: number;
  name: string;
  /** Largest shareholder, player id + 1. */
  controller: number;
  stockSlot: number;
  category: number;
  facing: number;
  resource: number;
  baseFee: number;
  value: number;
  fundA: number;
  fundB: number;
  freeShares: number;
}

export interface Landscape {
  id: number;
  x: number;
  y: number;
  name: string;
  facing: number;
  resource: number;
}

export interface Board {
  name: string;
  mapId: number;
  /** Side of the square world in map px (the ground's size): 2304 for the originals; a remake map may be bigger (九州 3456). */
  size?: number;
  nodes: BoardNode[];
  lands: Land[];
  facilities: Facility[];
  companies: Company[];
  landscapes: Landscape[];
  /**
   * The map's own names of its 12 stocks by slot (a remake city's local firms, editor/city_companies.py); missing on
   * the original maps, whose names are the stock table's (03 §2.4). Only names: the table's numbers stay.
   */
  stockNames?: string[];
}

/** One record of the extracted map JSON (only what the parser needs). */
interface RawRecord { id: number; raw_hex: string }
export interface RawMap {
  map_id: number;
  name: string;
  /** Ground width in map px (2304 when missing). */
  width?: number;
  nodes: RawRecord[];
  lands: RawRecord[];
  facilities: RawRecord[];
  companies: RawRecord[];
  landscapes: RawRecord[];
  /** The map's own 12 stock names by slot (remake cities). */
  stock_names?: string[];
}

class Bytes {
  private view: DataView;
  readonly bytes: Uint8Array;
  constructor(hex: string) {
    this.bytes = new Uint8Array(hex.length / 2);
    for (let i = 0; i < this.bytes.length; i++) this.bytes[i] = parseInt(hex.substr(i * 2, 2), 16);
    this.view = new DataView(this.bytes.buffer);
  }
  u8 = (o: number) => this.view.getUint8(o);
  u16 = (o: number) => this.view.getUint16(o, true);
  i16 = (o: number) => this.view.getInt16(o, true);
  u32 = (o: number) => this.view.getUint32(o, true);
  i32 = (o: number) => this.view.getInt32(o, true);
  u16s = (o: number, n: number) => Array.from({ length: n }, (_, i) => this.u16(o + i * 2));
  /** Zero-terminated Big5 text. */
  big5(o: number, max: number): string {
    const raw = this.bytes.subarray(o, o + max);
    const end = raw.indexOf(0);
    return big5Decoder.decode(raw.subarray(0, end < 0 ? max : end));
  }
}
const big5Decoder = new TextDecoder('big5');

export function parseBoard(raw: RawMap): Board {
  const nodes = raw.nodes.map((r): BoardNode => {
    const b = new Bytes(r.raw_hex);
    const status = b.u32(36);
    return {
      id: r.id, x: b.i16(0), y: b.i16(2), adjacent: b.u16s(24, 4), ref: b.u16(32), aux: b.u16(34),
      event: status & 0xff, oneWay: (status >>> 27) & 0xf, noDrop: (status & 0x80000000) !== 0,
    };
  });
  const lands = raw.lands.map((r): Land => {
    const b = new Bytes(r.raw_hex);
    return {
      id: r.id, x: b.i16(0), y: b.i16(2), name: b.big5(4, 16), tmpState: b.u8(0x17), chain: b.u8(0x18) !== 0,
      owner: b.u8(0x19), level: b.u8(0x1a), facing: b.u8(0x1b), price: b.u16(0x1c), perLevel: b.u16(0x1e),
      tolls: b.u16s(0x20, 6), lastToll: b.u32(0x2c), expire: b.u32(0x30),
    };
  });
  const facilities = raw.facilities.map((r): Facility => {
    const b = new Bytes(r.raw_hex);
    return {
      id: r.id, x: b.i16(0), y: b.i16(2), name: b.big5(4, 16), type: b.u8(0x18), owner: b.u8(0x19), level: b.u8(0x1a),
      tmpState: b.u8(0x1c), labTool: b.u8(0x1d), labDays: b.u8(0x1e), price: b.u16(0x22), fees: b.u16s(0x24, 6),
      lastFee: b.u32(0x30), expire: b.u32(0x34),
    };
  });
  const companies = raw.companies.map((r): Company => {
    const b = new Bytes(r.raw_hex);
    return {
      id: r.id, x: b.i16(0), y: b.i16(2), name: b.big5(4, 16), controller: b.u8(0x18), stockSlot: b.u8(0x19),
      category: b.u8(0x1a), facing: b.u8(0x1b), resource: b.u16(0x20), baseFee: b.u16(0x22), value: b.i32(0x24),
      fundA: b.i32(0x28), fundB: b.i32(0x2c), freeShares: b.i32(0x30),
    };
  });
  const landscapes = raw.landscapes.map((r): Landscape => {
    const b = new Bytes(r.raw_hex);
    return { id: r.id, x: b.i16(0), y: b.i16(2), name: b.big5(4, 16), facing: b.u16(0x18), resource: b.u16(0x1a) };
  });
  const board: Board = { name: raw.name, mapId: raw.map_id, size: raw.width ?? 2304, nodes, lands, facilities, companies, landscapes };
  if (raw.stock_names?.length === 12) board.stockNames = [...raw.stock_names];
  return board;
}

/** The world's side in map px (2304 unless the map says otherwise). */
export const worldSize = (board: Board) => board.size ?? 2304;

/** Records are 1-based in the original; lookups go through these helpers. */
export const nodeById = (board: Board, id: number) => board.nodes[id - 1];
export const landOf = (board: Board, node: BoardNode) => (node.ref > 2000 && node.ref < 4000 ? board.lands[node.ref - 2001] : undefined);
export const facilityOf = (board: Board, node: BoardNode) => (node.ref > 4000 && node.ref < 6000 ? board.facilities[node.ref - 4001] : undefined);
export const companyOf = (board: Board, node: BoardNode) => (node.ref > 6000 && node.ref < 8000 ? board.companies[node.ref - 6001] : undefined);
