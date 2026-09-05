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
