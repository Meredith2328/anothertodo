declare global {
  interface Window {
    Native: { invoke(method: string, args: string): string; request(id: string, method: string, args: string): void };
    nativeResult: (id: string, result: { ok: boolean; value?: unknown; error?: string; code?: string }) => void;
    nativeRefresh: () => void;
    nativeBack: () => boolean;
    nativeOpenTask: (id: string) => void;
    nativeTheme: (mode: 'dark' | 'light') => void;
  }
}
type Result<T> = { ok: boolean; value: T; error?: string; code?: string };
const unwrap = <T>(result: Result<T>): T => {
  if (!result.ok) throw Object.assign(new Error(result.error), { code: result.code });
  return result.value;
};
export const native = <T>(method: string, args: unknown = {}): T => unwrap(JSON.parse(window.Native.invoke(method, JSON.stringify(args))) as Result<T>);
const pending = new Map<string, { resolve: (value: unknown) => void; reject: (error: Error) => void }>();
window.nativeResult = (id, result) => {
  const operation = pending.get(id);
  if (!operation) throw new Error(`找不到原生请求 ${id}`);
  pending.delete(id);
  if (result.ok) operation.resolve(result.value);
  else operation.reject(Object.assign(new Error(result.error), { code: result.code }));
};
export const request = <T>(method: string, args: unknown): Promise<T> => new Promise((resolve, reject) => {
  const id = crypto.randomUUID();
  pending.set(id, { resolve: value => resolve(value as T), reject });
  window.Native.request(id, method, JSON.stringify(args));
});
