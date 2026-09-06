export type MembershipRole = "owner" | "manager" | "staff";

export type MovementReason = "purchase" | "usage" | "adjustment" | "waste";

export type Organization = {
  id: string;
  name: string;
  created_at: string;
};

export type Membership = {
  user_id: string;
  org_id: string;
  role: MembershipRole;
  created_at: string;
};

export type Supplier = {
  id: string;
  org_id: string;
  name: string;
  contact_email: string | null;
  phone: string | null;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type InventoryItem = {
  id: string;
  org_id: string;
  name: string;
  sku: string | null;
  category: string | null;
  unit: string;
  quantity: number;
  reorder_level: number;
  unit_cost: number;
  supplier_id: string | null;
  created_at: string;
  updated_at: string;
};

export type StockMovement = {
  id: string;
  org_id: string;
  item_id: string;
  delta: number;
  reason: MovementReason;
  note: string | null;
  created_by: string | null;
  created_at: string;
};

export type InventoryItemWithSupplier = InventoryItem & {
  suppliers: Pick<Supplier, "id" | "name"> | null;
};

export type StockMovementWithItem = StockMovement & {
  inventory_items: Pick<InventoryItem, "id" | "name" | "unit" | "sku"> | null;
};

export type Station = "Server" | "Cook" | "Bartender" | "Host" | "Dish" | "Manager" | "Other";

export type ShiftStatus = "draft" | "published";

export type Employee = {
  id: string;
  org_id: string;
  user_id: string | null;
  full_name: string;
  email: string | null;
  phone: string | null;
  position: Station;
  hourly_rate: number;
  active: boolean;
  created_at: string;
  updated_at: string;
};

export type Shift = {
  id: string;
  org_id: string;
  employee_id: string | null;
  position: Station;
  starts_at: string;
  ends_at: string;
  status: ShiftStatus;
  note: string | null;
  created_by: string | null;
  created_at: string;
  updated_at: string;
};

export type ShiftWithEmployee = Shift & {
  employees: Pick<Employee, "id" | "full_name" | "position" | "user_id"> | null;
};

export type InvoiceStatus = "received" | "extracted" | "reviewed" | "exported";
export type InvoiceSource = "upload" | "whatsapp" | "camera";
export type InvoiceCategory = "food" | "kitchen" | "cleaning" | "tax" | "beverage" | "other";

export type Restaurant = {
  id: string;
  org_id: string;
  name: string;
  qbo_company_name: string;
  slug: string;
  notes: string | null;
  created_at: string;
  updated_at: string;
};

export type RestaurantAliasRow = {
  id: string;
  org_id: string;
  restaurant_id: string;
  match_kind: "whatsapp_group" | "whatsapp_from" | "caption" | "customer";
  match_text: string;
};

export type Invoice = {
  id: string;
  org_id: string;
  restaurant_id: string | null;
  supplier_id: string | null;
  vendor_name: string | null;
  invoice_number: string | null;
  invoice_date: string | null;
  due_date: string | null;
  terms: string;
  currency: string;
  subtotal: number;
  tax: number;
  total: number;
  ap_account: string;
  status: InvoiceStatus;
  source: InvoiceSource;
  whatsapp_from: string | null;
  whatsapp_group: string | null;
  whatsapp_message_id: string | null;
  caption: string | null;
  image_data: string | null;
  image_mime: string | null;
  ocr_text: string | null;
  created_by: string | null;
  exported_at: string | null;
  created_at: string;
  updated_at: string;
};

export type InvoiceLine = {
  id: string;
  org_id: string;
  invoice_id: string;
  code: string | null;
  description: string;
  qty_ordered: number;
  qty_shipped: number;
  uom: string | null;
  pounds: number | null;
  unit_price: number;
  amount: number;
  category: InvoiceCategory;
  created_at: string;
};

export type InvoiceExpenseLine = {
  id: string;
  org_id: string;
  invoice_id: string;
  account: string;
  amount: number;
  memo: string | null;
  sort_order: number;
  created_at: string;
};

export type VendorAliasRow = {
  id: string;
  org_id: string;
  match_text: string;
  supplier_id: string;
  qbo_vendor_name: string;
};

export type AccountRuleRow = {
  id: string;
  org_id: string;
  keyword: string;
  account: string;
  memo: string | null;
  category: InvoiceCategory;
};

export type InvoiceWithSupplier = Invoice & {
  suppliers: Pick<Supplier, "id" | "name"> | null;
  restaurants: Pick<Restaurant, "id" | "name" | "qbo_company_name" | "slug"> | null;
  invoice_lines: InvoiceLine[];
  invoice_expense_lines: InvoiceExpenseLine[];
};
