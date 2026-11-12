/// <reference types="vite/client" />

declare module 'virtual:packed-boards' {
  const boards: import('./boardPacking').PackedBoards;
  export default boards;
}
