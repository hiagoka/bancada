// Id curto para título e tela: os 8 primeiros caracteres do UUID, em maiúsculas.
export const shortId = (id: string): string => id.slice(0, 8).toUpperCase();
