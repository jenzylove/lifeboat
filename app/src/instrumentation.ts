export async function register() {
  if (process.env.NEXT_RUNTIME === 'nodejs' && process.env.NODE_ENV === 'production' && process.env.BOARD_WARM !== '0') {
    const { warmBoard } = await import('./lib/server/board');
    warmBoard();
  }
}
