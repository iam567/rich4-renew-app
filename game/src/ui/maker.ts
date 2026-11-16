/** 自建地圖 (the user 2026-11-11): the in-game map editor, opened by the title's fifth button (ui/maker/editor.ts). */
export { onPlayLib, openMaker, openMakerMap } from './maker/editor';
export { makeThumbs as makeMyMapThumbs, prepareMakerMap, restoreMakerMap } from './maker/compile';
export { isLibKey, LIB_MAP_ID, libMapName, libPlayed, myLibMaps, PARTY_LIB_ON, readyLibMap, type PartyLibMap } from './maker/party-lib';
export { played as libraryPlayed } from './maker/library';
export { listMaps as myMaps, loadMap as loadMyMap, mapStatusTag as myMapTag, loadThumb as myMapThumb, savedForm as savedMyMap } from './maker/model';
