export class OperationError extends Error {
  constructor(readonly code: string, message: string) { super(message); this.name = "OperationError"; }
}
export const operationError = (error: unknown): { code: string; message: string } => {
  if (error instanceof OperationError) return { code: error.code, message: error.message };
  if (error instanceof Error && error.name === "ConcurrentModificationError") return { code: "VERSION_CONFLICT", message: error.message };
  if (error instanceof Error && error.name === "ZodError") return { code: "INVALID_INPUT", message: error.message };
  return { code: "OPERATION_FAILED", message: error instanceof Error ? error.message : String(error) };
};
