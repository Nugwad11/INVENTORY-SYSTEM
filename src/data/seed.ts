import type {
  Batch,
  Category,
  DemoState,
  Location,
  Movement,
  Product,
  PurchaseOrder,
  Receipt,
  Role,
  Sale,
  SaleLine,
  Settings,
  StockCount,
  StockStatus,
  Supplier,
  User,
  WriteOff,
} from '../types';
import { uid, docNumber } from '../lib/id';
import { recordAudit } from '../domain/audit';
import { syncAlerts } from '../domain/alerts';
import { computeStock, roundQty } from '../domain/inventory';

interface LotPlan {
  target: number;
  expiryDays: number | null;
  receivedDaysAgo: number;
  location: 'shop' | 'store';
  batchNo?: string;
  allowSales?: boolean;
  expired?: boolean;
}

interface CatalogPlan {
  sku: string;
  name: string;
  brand: string;
  categoryId: string;
  baseUnit: 'each' | 'kg' | 'litre';
  barcode: string;
  packSize: number;
  packLabel: string;
  cost: number;
  price: number;
  perishable: boolean;
  batchTracked: boolean;
  weighed?: boolean;
  expiryWarningDays: number;
  reorderPoint: number;
  safetyStock: number;
  reorderMultiple: number;
  supplierId: string;
  velocity: number;
  lots: LotPlan[];
}

interface PlannedAllocation {
  lotIndex: number;
  qty: number;
}

interface PlannedSaleLine {
  productIndex: number;
  qty: number;
  allocations: PlannedAllocation[];
}

interface PlannedSale {
  at: Date;
  payment: Sale['payment'];
  cashierId: string;
  lines: PlannedSaleLine[];
}

const DAY = 86_400_000;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

export function createSeedState(): DemoState {
  const rand = mulberry32(20261027);
  const now = new Date();
  const dayStart = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const at = (daysAgo: number, hour = 10, minute = 0): Date => {
    const d = new Date(dayStart);
    d.setDate(d.getDate() - daysAgo);
    d.setHours(hour, minute, 0, 0);
    return d;
  };
  const iso = (d: Date) => d.toISOString();
  const expiryIso = (daysFromToday: number): string => {
    const d = new Date(dayStart);
    d.setDate(d.getDate() + daysFromToday);
    d.setHours(12, 0, 0, 0);
    return d.toISOString();
  };

  const store = {
    id: 'store-greenfield',
    name: 'Greenfield Supermarket',
    code: 'GF-LEK-01',
    timezone: 'Africa/Lagos',
    currency: 'NGN',
    address: '12 Admiralty Way, Lekki Phase 1, Lagos',
    tradingDayCutoff: '00:00',
  };

  const locations: Location[] = [
    { id: 'loc-shop', name: 'Shop Floor', type: 'SELLING', sellingAllowed: true, active: true },
    { id: 'loc-store', name: 'Back Store', type: 'STORAGE', sellingAllowed: false, active: true },
    { id: 'loc-quarantine', name: 'Quarantine', type: 'QUARANTINE', sellingAllowed: false, active: true },
    { id: 'loc-damaged', name: 'Damaged Bay', type: 'DAMAGED', sellingAllowed: false, active: true },
    { id: 'loc-returns', name: 'Returns Bench', type: 'RETURNS', sellingAllowed: false, active: true },
  ];

  const categories: Category[] = [
    { id: 'cat-beverages', name: 'Beverages', expiryWarningDays: 45, color: '#2f7de1' },
    { id: 'cat-dairy', name: 'Dairy & Chilled', expiryWarningDays: 14, color: '#24a3a3' },
    { id: 'cat-grains', name: 'Grains & Staples', expiryWarningDays: 60, color: '#c28a2c' },
    { id: 'cat-snacks', name: 'Snacks & Bakery', expiryWarningDays: 7, color: '#c96532' },
    { id: 'cat-household', name: 'Household', expiryWarningDays: 90, color: '#7b6ac9' },
    { id: 'cat-personal', name: 'Personal Care', expiryWarningDays: 90, color: '#c0609b' },
    { id: 'cat-frozen', name: 'Frozen', expiryWarningDays: 30, color: '#4a90a4' },
  ];

  const suppliers: Supplier[] = [
    { id: 'sup-fresh', name: 'Fresh Dairy Nigeria', contactName: 'Ifeoma Nwosu', phone: '+234 803 411 2200', email: 'orders@freshdairy.ng', leadTimeDays: 2, reviewDays: 1, paymentTerms: 'Net 14', minOrder: 5_000_000, active: true },
    { id: 'sup-golden', name: 'Golden Grain Mills', contactName: 'Sani Bello', phone: '+234 806 552 9010', email: 'sales@goldengrain.ng', leadTimeDays: 4, reviewDays: 2, paymentTerms: 'Net 21', minOrder: 8_000_000, active: true },
    { id: 'sup-lagos', name: 'Lagos Foods Distribution', contactName: 'Yemi Alade', phone: '+234 809 220 4411', email: 'tunde@lagosfoods.ng', leadTimeDays: 3, reviewDays: 1, paymentTerms: 'Net 7', minOrder: 4_000_000, active: true },
    { id: 'sup-chi', name: 'Chi Snacks Ltd', contactName: 'Nneka Uche', phone: '+234 802 773 1288', email: 'keyaccounts@chisnacks.ng', leadTimeDays: 3, reviewDays: 2, paymentTerms: 'Net 14', minOrder: 3_000_000, active: true },
    { id: 'sup-homecare', name: 'HomeCare Essentials', contactName: 'Ahmed Lawal', phone: '+234 805 330 7766', email: 'orders@homecare.ng', leadTimeDays: 5, reviewDays: 2, paymentTerms: 'Net 30', minOrder: 6_000_000, active: true },
    { id: 'sup-bakery', name: 'Fresh Bake Bakery', contactName: 'Kemi Ajayi', phone: '+234 807 110 4455', email: 'kemi@freshbake.ng', leadTimeDays: 1, reviewDays: 1, paymentTerms: 'Cash on delivery', minOrder: 500_000, active: true },
    { id: 'sup-coldchain', name: 'ColdChain Foods', contactName: 'Peter Okon', phone: '+234 810 884 3322', email: 'supply@coldchain.ng', leadTimeDays: 2, reviewDays: 1, paymentTerms: 'Net 7', minOrder: 4_000_000, active: true },
  ];

  const users: User[] = [
    { id: 'usr-owner', name: 'David Akwu', role: 'owner', phone: '+234 803 000 1001', active: true },
    { id: 'usr-manager', name: 'Ngozi Okafor', role: 'manager', phone: '+234 803 000 1002', active: true },
    { id: 'usr-purchasing', name: 'Tunde Bakare', role: 'purchasing', phone: '+234 803 000 1003', active: true },
    { id: 'usr-receiving', name: 'Musa Ibrahim', role: 'receiving', phone: '+234 803 000 1004', active: true },
    { id: 'usr-stock', name: 'Blessing Eze', role: 'stock', phone: '+234 803 000 1005', active: true },
    { id: 'usr-cashier', name: 'Chinedu Obi', role: 'cashier', phone: '+234 803 000 1006', active: true },
    { id: 'usr-auditor', name: 'Funke Adeyemi', role: 'auditor', phone: '+234 803 000 1007', active: true },
  ];

  const catalog: CatalogPlan[] = [
    {
      sku: 'BEV-001', name: 'Coca-Cola PET 50cl', brand: 'Coca-Cola', categoryId: 'cat-beverages',
      baseUnit: 'each', barcode: '5449000000996', packSize: 12, packLabel: 'pack of 12',
      cost: 18_000, price: 25_000, perishable: false, batchTracked: true, expiryWarningDays: 45,
      reorderPoint: 48, safetyStock: 24, reorderMultiple: 24, supplierId: 'sup-lagos', velocity: 4.2,
      lots: [
        { target: 72, expiryDays: 150, receivedDaysAgo: 32, location: 'shop' },
        { target: 24, expiryDays: 150, receivedDaysAgo: 32, location: 'store' },
      ],
    },
    {
      sku: 'BEV-002', name: 'Eva Table Water 75cl', brand: 'Eva', categoryId: 'cat-beverages',
      baseUnit: 'each', barcode: '6151100000452', packSize: 12, packLabel: 'pack of 12',
      cost: 12_000, price: 20_000, perishable: false, batchTracked: true, expiryWarningDays: 45,
      reorderPoint: 72, safetyStock: 36, reorderMultiple: 24, supplierId: 'sup-lagos', velocity: 5.4,
      lots: [
        { target: 100, expiryDays: 180, receivedDaysAgo: 28, location: 'shop' },
        { target: 20, expiryDays: 180, receivedDaysAgo: 28, location: 'store' },
      ],
    },
    {
      sku: 'BEV-003', name: 'Chi Exotic Juice 1L', brand: 'Chi', categoryId: 'cat-beverages',
      baseUnit: 'each', barcode: '6151100000773', packSize: 12, packLabel: 'pack of 12',
      cost: 95_000, price: 120_000, perishable: false, batchTracked: true, expiryWarningDays: 45,
      reorderPoint: 24, safetyStock: 12, reorderMultiple: 12, supplierId: 'sup-chi', velocity: 1.7,
      lots: [{ target: 12, expiryDays: 20, receivedDaysAgo: 22, location: 'shop' }],
    },
    {
      sku: 'BEV-004', name: 'Bournvita Chocolate Drink 500g', brand: 'Cadbury', categoryId: 'cat-beverages',
      baseUnit: 'each', barcode: '6151100000889', packSize: 6, packLabel: 'pack of 6',
      cost: 480_000, price: 560_000, perishable: false, batchTracked: true, expiryWarningDays: 60,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-lagos', velocity: 0.7,
      lots: [],
    },
    {
      sku: 'DRY-001', name: 'Peak Full Cream Milk 400g', brand: 'Peak', categoryId: 'cat-dairy',
      baseUnit: 'each', barcode: '6151100001001', packSize: 24, packLabel: 'carton of 24',
      cost: 320_000, price: 375_000, perishable: true, batchTracked: true, expiryWarningDays: 30,
      reorderPoint: 24, safetyStock: 12, reorderMultiple: 12, supplierId: 'sup-fresh', velocity: 1.1,
      lots: [{ target: 36, expiryDays: 180, receivedDaysAgo: 30, location: 'shop' }],
    },
    {
      sku: 'DRY-002', name: 'Dano Full Cream Milk 900g', brand: 'Dano', categoryId: 'cat-dairy',
      baseUnit: 'each', barcode: '6151100001002', packSize: 12, packLabel: 'carton of 12',
      cost: 620_000, price: 720_000, perishable: true, batchTracked: true, expiryWarningDays: 30,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-fresh', velocity: 0.6,
      lots: [{ target: 18, expiryDays: 90, receivedDaysAgo: 24, location: 'shop' }],
    },
    {
      sku: 'DRY-003', name: 'Farm Fresh Eggs (crate of 30)', brand: 'Farm Fresh', categoryId: 'cat-dairy',
      baseUnit: 'each', barcode: '6151100001003', packSize: 1, packLabel: 'crate',
      cost: 480_000, price: 580_000, perishable: true, batchTracked: true, expiryWarningDays: 14,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-fresh', velocity: 0.9,
      lots: [
        { target: 5, expiryDays: 12, receivedDaysAgo: 9, location: 'shop' },
        { target: 10, expiryDays: 20, receivedDaysAgo: 4, location: 'shop' },
      ],
    },
    {
      sku: 'GRN-001', name: 'Golden Penny Semovita 1kg', brand: 'Golden Penny', categoryId: 'cat-grains',
      baseUnit: 'each', barcode: '6151100002001', packSize: 10, packLabel: 'pack of 10',
      cost: 145_000, price: 175_000, perishable: false, batchTracked: false, expiryWarningDays: 60,
      reorderPoint: 20, safetyStock: 10, reorderMultiple: 10, supplierId: 'sup-golden', velocity: 1.0,
      lots: [{ target: 40, expiryDays: 150, receivedDaysAgo: 40, location: 'shop' }],
    },
    {
      sku: 'GRN-002', name: 'Mama Gold Rice 5kg', brand: 'Mama Gold', categoryId: 'cat-grains',
      baseUnit: 'each', barcode: '6151100002002', packSize: 5, packLabel: 'pack of 5',
      cost: 620_000, price: 750_000, perishable: false, batchTracked: false, expiryWarningDays: 60,
      reorderPoint: 15, safetyStock: 8, reorderMultiple: 5, supplierId: 'sup-golden', velocity: 0.7,
      lots: [{ target: 28, expiryDays: 240, receivedDaysAgo: 40, location: 'shop' }],
    },
    {
      sku: 'GRN-003', name: 'Basmati Rice 2kg', brand: 'Aroma', categoryId: 'cat-grains',
      baseUnit: 'each', barcode: '6151100002003', packSize: 6, packLabel: 'pack of 6',
      cost: 380_000, price: 450_000, perishable: false, batchTracked: false, expiryWarningDays: 60,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-golden', velocity: 0.5,
      lots: [{ target: 24, expiryDays: 300, receivedDaysAgo: 40, location: 'shop' }],
    },
    {
      sku: 'GRN-004', name: 'Dangote Granulated Sugar 1kg', brand: 'Dangote', categoryId: 'cat-grains',
      baseUnit: 'each', barcode: '6151100002004', packSize: 10, packLabel: 'pack of 10',
      cost: 145_000, price: 170_000, perishable: false, batchTracked: false, expiryWarningDays: 60,
      reorderPoint: 20, safetyStock: 10, reorderMultiple: 10, supplierId: 'sup-golden', velocity: 0.8,
      lots: [{ target: 35, expiryDays: 300, receivedDaysAgo: 40, location: 'shop' }],
    },
    {
      sku: 'GRN-005', name: "King's Vegetable Oil 1L", brand: "King's", categoryId: 'cat-grains',
      baseUnit: 'each', barcode: '6151100002005', packSize: 12, packLabel: 'carton of 12',
      cost: 210_000, price: 250_000, perishable: false, batchTracked: false, expiryWarningDays: 60,
      reorderPoint: 24, safetyStock: 12, reorderMultiple: 12, supplierId: 'sup-golden', velocity: 0.7,
      lots: [{ target: 40, expiryDays: 200, receivedDaysAgo: 40, location: 'shop' }],
    },
    {
      sku: 'GRN-006', name: 'Oloyin Honey Beans (per kg)', brand: 'Local', categoryId: 'cat-grains',
      baseUnit: 'kg', barcode: '6151100002006', packSize: 1, packLabel: '1 kg',
      cost: 180_000, price: 230_000, perishable: false, batchTracked: true, weighed: true, expiryWarningDays: 60,
      reorderPoint: 20, safetyStock: 10, reorderMultiple: 1, supplierId: 'sup-golden', velocity: 1.6,
      lots: [{ target: 45.75, expiryDays: 120, receivedDaysAgo: 35, location: 'shop' }],
    },
    {
      sku: 'SNK-001', name: 'Indomie Chicken Noodles 70g', brand: 'Indomie', categoryId: 'cat-snacks',
      baseUnit: 'each', barcode: '6151100003001', packSize: 40, packLabel: 'carton of 40',
      cost: 28_000, price: 35_000, perishable: false, batchTracked: true, expiryWarningDays: 30,
      reorderPoint: 80, safetyStock: 40, reorderMultiple: 40, supplierId: 'sup-lagos', velocity: 7.5,
      lots: [
        { target: 84, expiryDays: 120, receivedDaysAgo: 33, location: 'shop' },
        { target: 30, expiryDays: 120, receivedDaysAgo: 33, location: 'store' },
      ],
    },
    {
      sku: 'SNK-002', name: 'Gala Sausage Roll', brand: 'Gala', categoryId: 'cat-snacks',
      baseUnit: 'each', barcode: '6151100003002', packSize: 20, packLabel: 'pack of 20',
      cost: 25_000, price: 35_000, perishable: true, batchTracked: true, expiryWarningDays: 14,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 10, supplierId: 'sup-chi', velocity: 2.8,
      lots: [
        { target: 8, expiryDays: 9, receivedDaysAgo: 12, location: 'shop' },
        { target: 12, expiryDays: 25, receivedDaysAgo: 4, location: 'shop' },
      ],
    },
    {
      sku: 'SNK-003', name: 'Agege Bread (family loaf)', brand: 'Fresh Bake', categoryId: 'cat-snacks',
      baseUnit: 'each', barcode: '6151100003003', packSize: 10, packLabel: 'pack of 10',
      cost: 45_000, price: 60_000, perishable: true, batchTracked: true, expiryWarningDays: 5,
      reorderPoint: 10, safetyStock: 6, reorderMultiple: 5, supplierId: 'sup-bakery', velocity: 4.1,
      lots: [
        { target: 6, expiryDays: 2, receivedDaysAgo: 3, location: 'shop' },
        { target: 4, expiryDays: -1, receivedDaysAgo: 25, location: 'shop', allowSales: false, expired: true, batchNo: 'BRD-OLD-2409' },
      ],
    },
    {
      sku: 'HHD-001', name: 'Omo Detergent 900g', brand: 'Omo', categoryId: 'cat-household',
      baseUnit: 'each', barcode: '6151100004001', packSize: 12, packLabel: 'carton of 12',
      cost: 175_000, price: 210_000, perishable: false, batchTracked: false, expiryWarningDays: 90,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-homecare', velocity: 0.5,
      lots: [
        { target: 18, expiryDays: 365, receivedDaysAgo: 50, location: 'shop' },
        { target: 10, expiryDays: 365, receivedDaysAgo: 50, location: 'store' },
      ],
    },
    {
      sku: 'HHD-002', name: 'Sunlight Dishwashing Liquid 500ml', brand: 'Sunlight', categoryId: 'cat-household',
      baseUnit: 'each', barcode: '6151100004002', packSize: 12, packLabel: 'carton of 12',
      cost: 70_000, price: 90_000, perishable: false, batchTracked: false, expiryWarningDays: 90,
      reorderPoint: 12, safetyStock: 6, reorderMultiple: 6, supplierId: 'sup-homecare', velocity: 0,
      lots: [{ target: 26, expiryDays: 365, receivedDaysAgo: 50, location: 'shop' }],
    },
    {
      sku: 'PC-001', name: 'Dettol Original Soap 165g', brand: 'Dettol', categoryId: 'cat-personal',
      baseUnit: 'each', barcode: '6151100005001', packSize: 24, packLabel: 'carton of 24',
      cost: 42_000, price: 55_000, perishable: false, batchTracked: false, expiryWarningDays: 90,
      reorderPoint: 24, safetyStock: 12, reorderMultiple: 12, supplierId: 'sup-homecare', velocity: 1.0,
      lots: [{ target: 60, expiryDays: 500, receivedDaysAgo: 50, location: 'shop' }],
    },
    {
      sku: 'PC-002', name: 'Close-Up Toothpaste 140g', brand: 'Close-Up', categoryId: 'cat-personal',
      baseUnit: 'each', barcode: '6151100005002', packSize: 12, packLabel: 'carton of 12',
      cost: 85_000, price: 110_000, perishable: false, batchTracked: false, expiryWarningDays: 90,
      reorderPoint: 18, safetyStock: 8, reorderMultiple: 6, supplierId: 'sup-homecare', velocity: 0.6,
      lots: [{ target: 34, expiryDays: 400, receivedDaysAgo: 50, location: 'shop' }],
    },
    {
      sku: 'FRZ-001', name: 'Frozen Chicken Drumsticks 1kg', brand: 'ColdChain', categoryId: 'cat-frozen',
      baseUnit: 'kg', barcode: '6151100006001', packSize: 1, packLabel: '1 kg pack',
      cost: 450_000, price: 550_000, perishable: true, batchTracked: true, weighed: true, expiryWarningDays: 30,
      reorderPoint: 10, safetyStock: 5, reorderMultiple: 5, supplierId: 'sup-coldchain', velocity: 0.8,
      lots: [{ target: 2, expiryDays: 75, receivedDaysAgo: 20, location: 'shop' }],
    },
  ];

  const products: Product[] = [];
  const batches: Batch[] = [];
  const lotIndex: { productId: string; batch: Batch; plan: LotPlan }[] = [];

  catalog.forEach((plan, productIndex) => {
    const productId = `prd-${String(productIndex + 1).padStart(3, '0')}`;
    const product: Product = {
      id: productId,
      sku: plan.sku,
      name: plan.name,
      brand: plan.brand,
      categoryId: plan.categoryId,
      baseUnit: plan.baseUnit,
      barcode: plan.barcode,
      packSize: plan.packSize,
      packLabel: plan.packLabel,
      cost: plan.cost,
      price: plan.price,
      active: true,
      weighed: !!plan.weighed,
      perishable: plan.perishable,
      batchTracked: plan.batchTracked,
      expiryWarningDays: plan.expiryWarningDays,
      reorderPoint: plan.reorderPoint,
      safetyStock: plan.safetyStock,
      reorderMultiple: plan.reorderMultiple,
      supplierId: plan.supplierId,
      defaultLocationId: 'loc-shop',
    };
    products.push(product);
    plan.lots.forEach((lot, idx) => {
      const batch: Batch = {
        id: uid('bat'),
        productId,
        batchNo: lot.batchNo ?? `${plan.sku}-${String(idx + 1).padStart(2, '0')}`,
        expiry: lot.expiryDays === null ? null : expiryIso(lot.expiryDays),
        receivedAt: iso(at(lot.receivedDaysAgo, 8, 0)),
        supplierId: plan.supplierId,
      };
      batches.push(batch);
      lotIndex.push({ productId, batch, plan: lot });
    });
  });

  const batchByIndex = new Map<number, Batch>();
  lotIndex.forEach((item, idx) => batchByIndex.set(idx, item.batch));

  const soldFromLot = new Map<number, number>();
  const plannedSales: PlannedSale[] = [];
  const cashierIds = ['usr-cashier', 'usr-manager'];

  for (let daysAgo = 29; daysAgo >= 0; daysAgo--) {
    const saleDate = at(daysAgo, 12, 0);
    const transactionCount = 2 + Math.floor(rand() * 3);
    for (let t = 0; t < transactionCount; t++) {
      const lineCount = 1 + Math.floor(rand() * 4);
      const chosen = new Set<number>();
      const lines: PlannedSaleLine[] = [];
      for (let l = 0; l < lineCount; l++) {
        const weights = catalog.map((c, i) => (chosen.has(i) || c.velocity <= 0 ? 0 : c.velocity));
        const total = weights.reduce((a, b) => a + b, 0);
        if (total <= 0) break;
        let r = rand() * total;
        let index = 0;
        for (let i = 0; i < weights.length; i++) {
          r -= weights[i];
          if (r <= 0) {
            index = i;
            break;
          }
        }
        if (chosen.has(index)) continue;
        chosen.add(index);
        const planItem = catalog[index];
        const qty = planItem.weighed
          ? roundQty(0.25 + rand() * 2.2)
          : Math.min(6, 1 + Math.floor(rand() * (planItem.velocity > 3 ? 4 : 3)));

        const eligible: { idx: number; expiry: number }[] = [];
        lotIndex.forEach((item, lotIdx) => {
          if (item.productId !== products[index].id) return;
          const lot = item.plan;
          if (lot.allowSales === false) return;
          if (lot.location !== 'shop') return;
          if (lot.receivedDaysAgo < daysAgo) return;
          if (lot.expired) return;
          if (lot.expiryDays !== null && lot.expiryDays < 0) return;
          eligible.push({
            idx: lotIdx,
            expiry: lot.expiryDays === null ? Number.MAX_SAFE_INTEGER : new Date(expiryIso(lot.expiryDays)).getTime(),
          });
        });
        eligible.sort((a, b) => a.expiry - b.expiry);
        if (eligible.length === 0) continue;

        let remaining = qty;
        const allocations: PlannedAllocation[] = [];
        for (const lot of eligible) {
          if (remaining <= 0.0005) break;
          const take = Math.min(remaining, qty);
          if (take <= 0.0005) continue;
          allocations.push({ lotIndex: lot.idx, qty: roundQty(take) });
          soldFromLot.set(lot.idx, (soldFromLot.get(lot.idx) ?? 0) + take);
          remaining = roundQty(remaining - take);
        }
        if (allocations.length > 0) lines.push({ productIndex: index, qty, allocations });
      }
      if (lines.length === 0) continue;
      const r = rand();
      const payment: Sale['payment'] = r < 0.55 ? 'CASH' : r < 0.85 ? 'TRANSFER' : 'CREDIT';
      const minute = Math.floor(rand() * 600);
      plannedSales.push({
        at: at(daysAgo, 8 + Math.floor(minute / 60), minute % 60),
        payment,
        cashierId: cashierIds[Math.floor(rand() * cashierIds.length)],
        lines,
      });
    }
  }

  plannedSales.sort((a, b) => a.at.getTime() - b.at.getTime());

  const movements: Movement[] = [];
  let tempSeq = 0;
  const pushMovement = (movement: Omit<Movement, 'seq'>) => {
    tempSeq += 1;
    movements.push({ ...movement, seq: tempSeq });
  };

  const actorFor = (id: string) => users.find((u) => u.id === id) ?? users[0];

  // Opening receipts: ending target plus everything sold from each lot.
  lotIndex.forEach((item, idx) => {
    const quantity = roundQty(item.plan.target + (soldFromLot.get(idx) ?? 0));
    if (quantity <= 0.0005) return;
    pushMovement({
      id: uid('mov'),
      transactionId: uid('txn'),
      type: 'OPENING',
      productId: item.productId,
      batchId: item.batch.id,
      qty: quantity,
      from: null,
      to: {
        locationId: item.plan.location === 'store' ? 'loc-store' : 'loc-shop',
        status: 'SELLABLE',
      },
      unitCost: products.find((p) => p.id === item.productId)?.cost ?? 0,
      value: Math.round(quantity * (products.find((p) => p.id === item.productId)?.cost ?? 0)),
      occurredAt: item.batch.receivedAt,
      postedAt: item.batch.receivedAt,
      refType: 'OPENING',
      refId: item.batch.id,
      actorId: 'usr-receiving',
      reason: 'Opening balance import',
      note: `Lot ${item.batch.batchNo}`,
      sync: 'SYNCED',
    });
  });

  const sales: Sale[] = [];
  let saleCounter = 0;

  plannedSales.forEach((planned) => {
    saleCounter += 1;
    const saleId = uid('sale');
    const number = docNumber('SALE', saleCounter);
    const lines: SaleLine[] = [];
    let subtotal = 0;
    planned.lines.forEach((plannedLine) => {
      const product = products[plannedLine.productIndex];
      plannedLine.allocations.forEach((allocation) => {
        const batch = batchByIndex.get(allocation.lotIndex);
        if (!batch) return;
        const line: SaleLine = {
          id: uid('sln'),
          productId: product.id,
          qty: allocation.qty,
          unitPrice: product.price,
          unitCost: product.cost,
          batchId: batch.id,
          returnedQty: 0,
        };
        lines.push(line);
        subtotal += Math.round(allocation.qty * product.price);
        pushMovement({
          id: uid('mov'),
          transactionId: saleId,
          type: 'SALE',
          productId: product.id,
          batchId: batch.id,
          qty: allocation.qty,
          from: { locationId: 'loc-shop', status: 'SELLABLE' },
          to: null,
          unitCost: product.cost,
          value: Math.round(allocation.qty * product.cost),
          occurredAt: planned.at.toISOString(),
          postedAt: planned.at.toISOString(),
          refType: 'SALE',
          refId: saleId,
          actorId: planned.cashierId,
          reason: 'POS sale',
          note: number,
          sync: 'SYNCED',
        });
      });
    });
    if (lines.length === 0) return;
    sales.push({
      id: saleId,
      number,
      lines,
      subtotal,
      discount: 0,
      total: subtotal,
      payment: planned.payment,
      status: 'COMPLETED',
      customerName: null,
      deviceId: 'TILL-01',
      cashierId: planned.cashierId,
      occurredAt: planned.at.toISOString(),
      createdAt: planned.at.toISOString(),
      voidedAt: null,
      voidedBy: null,
      voidReason: null,
      sync: 'SYNCED',
    });
  });

  // Status change for the expired bread lot.
  const expiredLot = lotIndex.find((item) => item.plan.expired);
  if (expiredLot) {
    pushMovement({
      id: uid('mov'),
      transactionId: uid('txn'),
      type: 'STATUS_CHANGE',
      productId: expiredLot.productId,
      batchId: expiredLot.batch.id,
      qty: expiredLot.plan.target,
      from: { locationId: 'loc-shop', status: 'SELLABLE' },
      to: { locationId: 'loc-shop', status: 'EXPIRED' },
      unitCost: products.find((p) => p.id === expiredLot.productId)?.cost ?? 0,
      value: Math.round(expiredLot.plan.target * (products.find((p) => p.id === expiredLot.productId)?.cost ?? 0)),
      occurredAt: iso(at(2, 7, 30)),
      postedAt: iso(at(2, 7, 30)),
      refType: 'SYSTEM',
      refId: expiredLot.batch.id,
      actorId: 'usr-stock',
      reason: 'Expiry sweep',
      note: 'Batch passed expiry; removed from sellable stock',
      sync: 'SYNCED',
    });

    const writeOffId = uid('wo');
    pushMovement({
      id: uid('mov'),
      transactionId: writeOffId,
      type: 'WRITE_OFF',
      productId: expiredLot.productId,
      batchId: expiredLot.batch.id,
      qty: 2,
      from: { locationId: 'loc-shop', status: 'EXPIRED' },
      to: null,
      unitCost: products.find((p) => p.id === expiredLot.productId)?.cost ?? 0,
      value: 2 * (products.find((p) => p.id === expiredLot.productId)?.cost ?? 0),
      occurredAt: iso(at(1, 16, 20)),
      postedAt: iso(at(1, 16, 20)),
      refType: 'WRITE_OFF',
      refId: writeOffId,
      actorId: 'usr-manager',
      reason: 'Expired — disposal',
      note: 'WO-00001',
      sync: 'SYNCED',
    });
  }

  // Transfer: back store to shop floor.
  const indomie = products.find((p) => p.sku === 'SNK-001');
  const indomieStoreBatch = indomie
    ? lotIndex.find((item) => item.productId === indomie.id && item.plan.location === 'store')?.batch
    : undefined;
  if (indomie && indomieStoreBatch) {
    pushMovement({
      id: uid('mov'),
      transactionId: uid('trf'),
      type: 'TRANSFER',
      productId: indomie.id,
      batchId: indomieStoreBatch.id,
      qty: 12,
      from: { locationId: 'loc-store', status: 'SELLABLE' },
      to: { locationId: 'loc-shop', status: 'SELLABLE' },
      unitCost: indomie.cost,
      value: 12 * indomie.cost,
      occurredAt: iso(at(2, 9, 15)),
      postedAt: iso(at(2, 9, 15)),
      refType: 'TRANSFER',
      refId: 'trf-00001',
      actorId: 'usr-stock',
      reason: 'Shelf replenishment',
      note: 'TRF-00001',
      sync: 'SYNCED',
    });
  }

  const transfers = indomie && indomieStoreBatch
    ? [
        {
          id: 'trf-00001',
          number: docNumber('TRF', 1),
          productId: indomie.id,
          batchId: indomieStoreBatch.id,
          qty: 12,
          fromLocationId: 'loc-store',
          toLocationId: 'loc-shop',
          status: 'POSTED' as const,
          reason: 'Shelf replenishment',
          actorId: 'usr-stock',
          at: iso(at(2, 9, 15)),
          sync: 'SYNCED' as const,
        },
      ]
    : [];

  // A posted count from last week with two variances.
  const postedCountId = uid('cnt');
  const coke = products.find((p) => p.sku === 'BEV-001');
  const eva = products.find((p) => p.sku === 'BEV-002');
  const tea = products.find((p) => p.sku === 'BEV-003');
  const cokeBatch = coke ? batches.find((b) => b.productId === coke.id) : undefined;
  const evaBatch = eva ? batches.find((b) => b.productId === eva.id) : undefined;
  const postedEntries = [
    { product: coke, batch: cokeBatch, variance: 2 },
    { product: eva, batch: evaBatch, variance: -1 },
  ].filter((e) => e.product && e.batch);
  postedEntries.forEach((entry) => {
    if (!entry.product || !entry.batch) return;
    const qty = Math.abs(entry.variance);
    pushMovement({
      id: uid('mov'),
      transactionId: postedCountId,
      type: 'COUNT',
      productId: entry.product.id,
      batchId: entry.batch.id,
      qty,
      from: entry.variance < 0 ? { locationId: 'loc-shop', status: 'SELLABLE' } : null,
      to: entry.variance > 0 ? { locationId: 'loc-shop', status: 'SELLABLE' } : null,
      unitCost: entry.product.cost,
      value: qty * entry.product.cost,
      occurredAt: iso(at(7, 18, 10)),
      postedAt: iso(at(7, 18, 10)),
      refType: 'COUNT',
      refId: postedCountId,
      actorId: 'usr-manager',
      reason: 'Count variance',
      note: 'CNT-00001',
      sync: 'SYNCED',
    });
  });

  // Void and return on recent sales.
  const returnable = [...sales].reverse().find((s) => s.status === 'COMPLETED' && s.lines.length > 0);
  if (returnable) {
    const line = returnable.lines[0];
    const product = products.find((p) => p.id === line.productId);
    if (product && line.batchId) {
      const qty = Math.min(1, line.qty);
      pushMovement({
        id: uid('mov'),
        transactionId: uid('txn'),
        type: 'RETURN',
        productId: product.id,
        batchId: line.batchId,
        qty,
        from: null,
        to: { locationId: 'loc-shop', status: 'SELLABLE' },
        unitCost: line.unitCost,
        value: Math.round(qty * line.unitCost),
        occurredAt: iso(at(1, 17, 5)),
        postedAt: iso(at(1, 17, 5)),
        refType: 'SALE',
        refId: returnable.id,
        actorId: 'usr-cashier',
        reason: 'Customer return — resaleable',
        note: `${returnable.number} return`,
        sync: 'SYNCED',
      });
      line.returnedQty = qty;
      returnable.status = 'PARTIAL_RETURN';
    }
  }

  const voidable = sales.find((s) => s.status === 'COMPLETED' && s.lines.length >= 2 && new Date(s.occurredAt) < new Date(Date.now() - 3 * DAY));
  if (voidable) {
    voidable.lines.forEach((line) => {
      const product = products.find((p) => p.id === line.productId);
      if (!product || !line.batchId) return;
      pushMovement({
        id: uid('mov'),
        transactionId: voidable.id,
        type: 'VOID',
        productId: product.id,
        batchId: line.batchId,
        qty: line.qty - line.returnedQty,
        from: null,
        to: { locationId: 'loc-shop', status: 'SELLABLE' },
        unitCost: line.unitCost,
        value: Math.round((line.qty - line.returnedQty) * line.unitCost),
        occurredAt: iso(at(2, 19, 30)),
        postedAt: iso(at(2, 19, 30)),
        refType: 'SALE',
        refId: voidable.id,
        actorId: 'usr-manager',
        reason: 'Cashier error — sale voided',
        note: `${voidable.number} void`,
        sync: 'SYNCED',
      });
    });
    voidable.status = 'VOIDED';
    voidable.voidedAt = iso(at(2, 19, 30));
    voidable.voidedBy = 'usr-manager';
    voidable.voidReason = 'Customer payment did not complete; sale voided at till.';
  }

  movements.sort((a, b) => new Date(a.occurredAt).getTime() - new Date(b.occurredAt).getTime());
  movements.forEach((m, idx) => {
    m.seq = idx + 1;
  });

  sales.sort((a, b) => new Date(b.occurredAt).getTime() - new Date(a.occurredAt).getTime());

  const purchaseOrders: PurchaseOrder[] = [
    {
      id: 'po-00001',
      number: docNumber('PO', 1),
      supplierId: 'sup-chi',
      status: 'SENT',
      lines: [
        { id: 'pol-1a', productId: products.find((p) => p.sku === 'BEV-003')!.id, qty: 48, receivedQty: 0, unitCost: 95_000 },
        { id: 'pol-1b', productId: products.find((p) => p.sku === 'SNK-002')!.id, qty: 40, receivedQty: 0, unitCost: 25_000 },
      ],
      expectedDate: iso(at(-2, 12, 0)),
      notes: 'Weekly snacks and juice replenishment.',
      version: 1,
      createdBy: 'usr-purchasing',
      createdAt: iso(at(4, 10, 20)),
      submittedAt: iso(at(4, 10, 20)),
      approvedAt: iso(at(4, 11, 5)),
      sentAt: iso(at(3, 9, 10)),
      closedAt: null,
      closeReason: null,
      approvals: [
        {
          id: uid('apr'),
          actorId: 'usr-manager',
          actorName: 'Ngozi Okafor',
          decision: 'APPROVED',
          comment: 'Approved for the weekly cycle.',
          at: iso(at(4, 11, 5)),
          limitSnapshot: 5_000_000,
        },
      ],
    },
    {
      id: 'po-00002',
      number: docNumber('PO', 2),
      supplierId: 'sup-fresh',
      status: 'PENDING_APPROVAL',
      lines: [
        { id: 'pol-2a', productId: products.find((p) => p.sku === 'DRY-001')!.id, qty: 48, receivedQty: 0, unitCost: 320_000 },
        { id: 'pol-2b', productId: products.find((p) => p.sku === 'DRY-002')!.id, qty: 24, receivedQty: 0, unitCost: 620_000 },
      ],
      expectedDate: iso(at(-5, 12, 0)),
      notes: 'Milk restock before the weekend.',
      version: 1,
      createdBy: 'usr-purchasing',
      createdAt: iso(at(1, 14, 15)),
      submittedAt: iso(at(1, 14, 15)),
      approvedAt: null,
      sentAt: null,
      closedAt: null,
      closeReason: null,
      approvals: [],
    },
    {
      id: 'po-00003',
      number: docNumber('PO', 3),
      supplierId: 'sup-golden',
      status: 'APPROVED',
      lines: [
        { id: 'pol-3a', productId: products.find((p) => p.sku === 'GRN-003')!.id, qty: 24, receivedQty: 0, unitCost: 380_000 },
        { id: 'pol-3b', productId: products.find((p) => p.sku === 'GRN-006')!.id, qty: 30, receivedQty: 0, unitCost: 180_000 },
      ],
      expectedDate: iso(at(-4, 12, 0)),
      notes: 'Rice and beans top-up.',
      version: 2,
      createdBy: 'usr-purchasing',
      createdAt: iso(at(2, 13, 0)),
      submittedAt: iso(at(2, 13, 40)),
      approvedAt: iso(at(2, 15, 10)),
      sentAt: null,
      closedAt: null,
      closeReason: null,
      approvals: [
        {
          id: uid('apr'),
          actorId: 'usr-manager',
          actorName: 'Ngozi Okafor',
          decision: 'APPROVED',
          comment: 'Approved. Send on Monday.',
          at: iso(at(2, 15, 10)),
          limitSnapshot: 5_000_000,
        },
      ],
    },
  ];

  const receipts: Receipt[] = [
    {
      id: 'rcpt-00001',
      number: docNumber('GRN', 1),
      supplierId: 'sup-chi',
      poId: 'po-00001',
      status: 'DRAFT',
      deliveryNote: 'CHI-DN-88410',
      lines: [
        {
          id: uid('rcl'),
          productId: products.find((p) => p.sku === 'BEV-003')!.id,
          expectedQty: 48,
          acceptedQty: 24,
          damagedQty: 1,
          rejectedQty: 3,
          shortQty: 20,
          unitCost: 95_000,
          batchNo: 'CHI-2411-A',
          expiry: expiryIso(70),
        },
        {
          id: uid('rcl'),
          productId: products.find((p) => p.sku === 'SNK-002')!.id,
          expectedQty: 40,
          acceptedQty: 20,
          damagedQty: 0,
          rejectedQty: 0,
          shortQty: 20,
          unitCost: 25_000,
          batchNo: 'GAL-2411-C',
          expiry: expiryIso(18),
        },
      ],
      createdBy: 'usr-receiving',
      createdAt: iso(at(0, 8, 40)),
      confirmedAt: null,
      confirmedBy: null,
      sync: 'SYNCED',
      note: 'Partial delivery — two cartons crushed. Awaiting supplier credit note.',
    },
  ];

  const bread = products.find((p) => p.sku === 'SNK-003');
  const breadFreshBatch = batches.find(
    (b) => b.productId === bread?.id && b.batchNo === 'SNK-003-01',
  );
  const writeOffs: WriteOff[] = [];
  if (expiredLot && bread) {
    writeOffs.push({
      id: uid('wo'),
      number: docNumber('WO', 1),
      productId: bread.id,
      batchId: expiredLot.batch.id,
      qty: 2,
      reason: 'Expired — disposal',
      note: 'Returned from shelf during the morning expiry sweep.',
      unitCost: bread.cost,
      value: 2 * bread.cost,
      status: 'POSTED',
      requestedBy: 'usr-stock',
      requestedAt: iso(at(1, 15, 45)),
      decidedBy: 'usr-manager',
      decidedAt: iso(at(1, 16, 20)),
      decisionNote: 'Approved for disposal.',
    });
    writeOffs.push({
      id: uid('wo'),
      number: docNumber('WO', 2),
      productId: bread.id,
      batchId: expiredLot.batch.id,
      qty: 2,
      reason: 'Expired — disposal',
      note: 'Remaining expired units on the quarantine shelf.',
      unitCost: bread.cost,
      value: 2 * bread.cost,
      status: 'PENDING_APPROVAL',
      requestedBy: 'usr-stock',
      requestedAt: iso(at(0, 9, 5)),
      decidedBy: null,
      decidedAt: null,
      decisionNote: null,
    });
  }

  const settings: Settings = {
    approvalLimitManager: 5_000_000,
    approvalLimitOwner: 50_000_000,
    receiptTolerancePct: 5,
    negativeStockAllowed: false,
    countVarianceThreshold: 2_000_000,
    lowStockWindowDays: 28,
    expiryWarningDays: 30,
    largeText: false,
    compactMode: false,
    autoLockDays: 7,
  };

  const stockAfter = computeStock({ products, locations, batches, movements });

  const recentSales = [...sales].slice(0, 6);
  const openCountId = uid('cnt');
  const countEntries = ['HHD-001', 'HHD-002', 'PC-001', 'PC-002']
    .map((sku) => products.find((p) => p.sku === sku))
    .filter((p): p is Product => !!p)
    .map((product) => ({
      id: uid('cen'),
      productId: product.id,
      systemQty: stockAfter.get(product.id)?.sellable ?? 0,
      countedQty: null,
      recountQty: null,
      note: '',
    }));

  const counts: StockCount[] = [
    {
      id: postedCountId,
      number: docNumber('CNT', 1),
      scope: 'Beverages — shop floor',
      locationId: 'loc-shop',
      status: 'POSTED',
      entries: postedEntries.map((entry) => ({
        id: uid('cen'),
        productId: entry.product!.id,
        systemQty: (stockAfter.get(entry.product!.id)?.sellable ?? 0) - entry.variance,
        countedQty: stockAfter.get(entry.product!.id)?.sellable ?? 0,
        recountQty: null,
        note: '',
      })),
      snapshotSeq: Math.max(1, movements.length - 6),
      counterId: 'usr-stock',
      submittedAt: iso(at(7, 17, 30)),
      submittedBy: 'usr-stock',
      approvedAt: iso(at(7, 18, 10)),
      approvedBy: 'usr-manager',
      rejectionComment: null,
      postedAt: iso(at(7, 18, 10)),
      createdAt: iso(at(8, 9, 0)),
    },
    {
      id: openCountId,
      number: docNumber('CNT', 2),
      scope: 'Household & personal care — shop floor',
      locationId: 'loc-shop',
      status: 'OPEN',
      entries: countEntries,
      snapshotSeq: movements.length,
      counterId: 'usr-stock',
      submittedAt: null,
      submittedBy: null,
      approvedAt: null,
      approvedBy: null,
      rejectionComment: null,
      postedAt: null,
      createdAt: iso(at(0, 8, 15)),
    },
  ];

  const state: DemoState = {
    version: 1,
    store,
    locations,
    categories,
    suppliers,
    products,
    batches,
    movements,
    purchaseOrders,
    receipts,
    sales,
    transfers,
    counts,
    writeOffs,
    alerts: [],
    users,
    currentUserId: 'usr-owner',
    settings,
    audit: [],
    seq: movements.length,
    counters: {
      SALE: sales.length,
      PO: purchaseOrders.length,
      RECEIPT: receipts.length,
      TRANSFER: transfers.length,
      COUNT: counts.length,
      WRITE_OFF: writeOffs.length,
    },
    lastSyncAt: iso(new Date(Date.now() - 8 * 60_000)),
    deviceId: 'TILL-01',
    seededAt: now.toISOString(),
  };

  // Seed a short, credible audit trail. The chain links from GENESIS.
  recordAudit(state, {
    actorId: 'usr-owner',
    actorName: 'David Akwu',
    action: 'DEMO_DATA_LOADED',
    entityType: 'SYSTEM',
    entityId: state.store.id,
    summary: 'Loaded pilot dataset: catalogue, 30 days of trading, stock, purchasing and count history.',
    reason: 'Demo environment initialisation',
  });
  recordAudit(state, {
    actorId: 'usr-manager',
    actorName: 'Ngozi Okafor',
    action: 'PO_APPROVED',
    entityType: 'PURCHASE_ORDER',
    entityId: 'po-00001',
    summary: 'Approved PO-00001 for Chi Snacks Ltd (₦9,560.00).',
    reason: 'Weekly snacks and juice replenishment.',
  });
  recordAudit(state, {
    actorId: 'usr-stock',
    actorName: 'Blessing Eze',
    action: 'COUNT_POSTED',
    entityType: 'STOCK_COUNT',
    entityId: postedCountId,
    summary: 'Posted CNT-00001 with 2 variance lines (net +1 unit).',
    reason: 'Count variance approved by Ngozi Okafor.',
  });
  recordAudit(state, {
    actorId: 'usr-manager',
    actorName: 'Ngozi Okafor',
    action: 'WRITE_OFF_POSTED',
    entityType: 'WRITE_OFF',
    entityId: writeOffs[0]?.id ?? 'wo',
    summary: 'Posted write-off of 2 expired Agege Bread units.',
    reason: 'Expired — disposal',
  });
  recentSales.forEach((sale) => {
    const actor = actorFor(sale.cashierId);
    recordAudit(state, {
      actorId: actor.id,
      actorName: actor.name,
      action: sale.status === 'VOIDED' ? 'SALE_VOIDED' : 'SALE_COMPLETED',
      entityType: 'SALE',
      entityId: sale.id,
      summary: `${sale.number} · ${sale.lines.length} line(s) · ₦${(sale.total / 100).toLocaleString('en-NG')}`,
      reason: sale.voidReason,
    });
  });

  syncAlerts(state);
  return state;
}

export const demoRoleOrder: Role[] = ['owner', 'manager', 'purchasing', 'receiving', 'stock', 'cashier', 'auditor'];
export const demoStatusFor = (status: StockStatus): string => status;
