/** opencc-js ships its dictionary modules (`opencc-js/dict/*`, one "source target|…" string each) without types. */
declare module 'opencc-js/dict/*' {
  const dict: string;
  export default dict;
}
