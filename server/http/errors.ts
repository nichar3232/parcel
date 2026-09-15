export class ApiError extends Error {
  constructor(
    public status: number,
    public code: string,
    message: string,
  ) {
    super(message);
    this.name = 'ApiError';
  }
}
export function friendlyChainError(error: unknown): string {
  const e = error as { message?: string; logs?: string[] };
  const detail = [e?.message, ...(e?.logs || [])].join(' ');
  const messages = [
    'Choose valid bounded spread terms.',
    'The quote deadline passed. The maker can reclaim the unfilled reserve.',
    'This action is unavailable in the current contract state. Refresh the position.',
    'This wallet is not authorized.',
    'The submitted terms differ from the funded offer.',
    'The escrow does not cover the maximum payout.',
    'The observation time has not arrived.',
    'The observation does not match the committed sample.',
    'This payout has already been claimed.',
    'The amount exceeds supported bounds.',
    'The settlement mint is unsupported.',
  ];
  for (let i = 0; i < messages.length; i++)
    if (detail.includes(`0x${(6000 + i).toString(16)}`)) return messages[i];
  return 'The chain operation could not be confirmed. Refresh its status before retrying.';
}
export function object(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== 'object' || Array.isArray(value))
    throw new ApiError(400, 'INVALID_BODY', 'A JSON object is required.');
  return value as Record<string, unknown>;
}
