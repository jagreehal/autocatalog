// The canvas reports how it is used through these; a catalog site sends nothing.
export const track = (_event: string, _properties?: Record<string, unknown>) => {};
export const bump = (_name: string, _by?: number) => {};
