type PaginationInput = {
  page: number;
  pageSize: number;
};

export function parsePagination(params: URLSearchParams, defaults: PaginationInput = { page: 1, pageSize: 20 }) {
  const rawPage = Number(params.get('page') ?? defaults.page);
  const rawPageSize = Number(params.get('pageSize') ?? defaults.pageSize);

  const page = Number.isFinite(rawPage) && rawPage > 0 ? Math.floor(rawPage) : defaults.page;
  let pageSize = Number.isFinite(rawPageSize) && rawPageSize > 0 ? Math.floor(rawPageSize) : defaults.pageSize;
  if (pageSize > 100) pageSize = 100;

  const skip = (page - 1) * pageSize;
  const take = pageSize;

  return { page, pageSize, skip, take };
}

export function buildPagination(total: number, page: number, pageSize: number) {
  const totalPages = Math.max(1, Math.ceil(total / pageSize));
  return { page, pageSize, total, totalPages };
}

export function parseBoolean(input: string | null): boolean | undefined {
  if (input === null) return undefined;
  if (input === 'true') return true;
  if (input === 'false') return false;
  return undefined;
}
