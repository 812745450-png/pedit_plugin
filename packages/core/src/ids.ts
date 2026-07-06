export type PeditId = string;

export type CreateId = (sourceId: PeditId) => PeditId;

export const hasId = <T extends { id: PeditId }>(items: readonly T[], id: PeditId): boolean =>
  items.some((item) => item.id === id);
