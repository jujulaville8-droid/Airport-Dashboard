type PageResult<T> = {
  data: T[] | null;
  error: Error | { message: string } | null;
};

const PAGE_SIZE = 1_000;
const MAX_PAGES = 100;

export async function fetchAllSalesPages<T>(
  loadPage: (from: number, to: number) => PromiseLike<PageResult<T>>,
): Promise<T[]> {
  const rows: T[] = [];
  for (let page = 0; page < MAX_PAGES; page += 1) {
    const from = page * PAGE_SIZE;
    const result = await loadPage(from, from + PAGE_SIZE - 1);
    if (result.error) {
      throw result.error instanceof Error ? result.error : new Error(result.error.message);
    }
    const data = result.data ?? [];
    rows.push(...data);
    if (data.length < PAGE_SIZE) return rows;
  }
  throw new Error('Sales query exceeded the safe pagination limit');
}
