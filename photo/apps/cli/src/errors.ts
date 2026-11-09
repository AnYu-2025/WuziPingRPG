/** 统一的错误信息提取。catch 到的东西可能是任何类型，这里只此一处处理。 */
export function errorMessage(e: unknown): string {
  if (e instanceof Error) return e.message;
  if (typeof e === 'string') return e;
  if (e === null || e === undefined) return String(e);
  try {
    return JSON.stringify(e);
  } catch {
    return String(e);
  }
}
