/**
 * Dev (`ng serve`): để rỗng — `/api/*` được proxy tới qc-api (xem `proxy.conf.json`, mặc định :3001).
 * Production: trỏ gateway / URL API thật nếu không dùng cùng origin.
 */
export const QC_API_BASE_URL = 'https://qc-api-fx29.onrender.com';

/** Port qc-api khi gọi trực tiếp (tài liệu / lỗi); đồng bộ với `qc-api/src/config.ts` và proxy. */
export const QC_API_DEV_PORT = 3001;
