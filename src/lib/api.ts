import type { Role } from '../types';

const TOKEN_KEY = 'storehouse.api.token.v1';

export const API_URL = (import.meta.env.VITE_API_URL as string | undefined)?.replace(/\/+$/, '') ?? 'http://localhost:4000';

export class ApiError extends Error {
  status: number;
  code: string;

  constructor(status: number, code: string, message: string) {
    super(message);
    this.name = 'ApiError';
    this.status = status;
    this.code = code;
  }
}

export interface ServerUser {
  id: string;
  storeId: string;
  name: string;
  role: Role;
  phone: string;
}

export interface LoginResult {
  token: string;
  mustChangePassword: boolean;
  user: ServerUser;
}

export interface ServerProduct {
  id: string;
  sku: string;
  name: string;
  brand: string;
  category: string;
  barcode: string | null;
  baseUnit: 'each' | 'kg' | 'litre' | 'metre';
  packSize: number;
  packLabel: string;
  costKobo: number;
  priceKobo: number;
  active: boolean;
  batchTracked: boolean;
  perishable: boolean;
  expiryWarningDays: number;
  reorderPoint: number;
  safetyStock: number;
  reorderMultiple: number;
  supplierId: string | null;
  defaultLocationId: string | null;
  sellingQty: number;
  totalQty: number;
}

export interface ServerStockRow {
  productId: string;
  sku: string;
  productName: string;
  batchId: string;
  batchNo: string;
  expiry: string | null;
  locationId: string;
  locationName: string;
  locationType: string;
  status: string;
  qty: number;
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PATCH' | 'DELETE';
  body?: unknown;
  token?: string | null;
}

async function request<T>(path: string, { method = 'GET', body, token }: RequestOptions = {}): Promise<T> {
  let response: Response;
  try {
    response = await fetch(`${API_URL}${path}`, {
      method,
      headers: {
        ...(body === undefined ? {} : { 'content-type': 'application/json' }),
        ...(token ? { authorization: `Bearer ${token}` } : {}),
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
  } catch {
    throw new ApiError(0, 'NETWORK', `Cannot reach the Storehouse API at ${API_URL}.`);
  }

  if (!response.ok) {
    const payload = (await response.json().catch(() => null)) as
      | { error?: { code?: string; message?: string } }
      | null;
    throw new ApiError(
      response.status,
      payload?.error?.code ?? 'REQUEST_FAILED',
      payload?.error?.message ?? `Request failed with status ${response.status}.`,
    );
  }

  if (response.status === 204) return undefined as T;
  return (await response.json()) as T;
}

export const api = {
  login(phone: string, password: string): Promise<LoginResult> {
    return request<LoginResult>('/api/auth/login', { method: 'POST', body: { phone, password } });
  },

  me(token: string): Promise<{ mustChangePassword: boolean; user: ServerUser }> {
    return request('/api/auth/me', { token });
  },

  changePassword(token: string, currentPassword: string, newPassword: string): Promise<{ changed: boolean }> {
    return request('/api/auth/change-password', {
      method: 'POST',
      token,
      body: { currentPassword, newPassword },
    });
  },

  async products(token: string): Promise<ServerProduct[]> {
    const result = await request<{ products: ServerProduct[] }>('/api/products?limit=200', { token });
    return result.products;
  },

  async stock(token: string): Promise<ServerStockRow[]> {
    const result = await request<{ stock: ServerStockRow[] }>('/api/stock', { token });
    return result.stock;
  },
};

export function readStoredToken(): string | null {
  try {
    return localStorage.getItem(TOKEN_KEY);
  } catch {
    return null;
  }
}

export function storeToken(token: string): void {
  try {
    localStorage.setItem(TOKEN_KEY, token);
  } catch {
    // Private windows can reject storage; the session still works in memory.
  }
}

export function clearStoredToken(): void {
  try {
    localStorage.removeItem(TOKEN_KEY);
  } catch {
    // Ignore storage failures.
  }
}
