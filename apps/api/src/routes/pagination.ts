export type PaginationParams = {
  page: number;
  limit: number;
};

export function parsePagination(
  pageStr?: string,
  limitStr?: string
): PaginationParams {
  const page = Math.max(1, parseInt(pageStr ?? "1", 10) || 1);
  const limit = Math.min(100, Math.max(1, parseInt(limitStr ?? "20", 10) || 20));
  return { page, limit };
}

export function paginationMeta(page: number, limit: number, total: number) {
  return {
    page,
    limit,
    total,
    totalPages: Math.ceil(total / limit) || 0,
  };
}
