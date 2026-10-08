export type CustomerProfile = {
  userId: string;
  email: string;
  displayName: string | null;
  phone: string | null;
  avatarUrl: string | null;
  role: "customer" | "admin" | "super_admin";
};

export type CustomerAddress = {
  id: string;
  label: string;
  fullName: string;
  phone: string;
  addressLine1: string;
  addressLine2: string | null;
  landmark: string | null;
  city: string;
  state: string;
  postalCode: string;
  country: string;
  isDefault: boolean;
  createdAt: string;
  updatedAt: string;
};

export type CustomerCartItem = {
  id: string;
  productId: string;
  variantId: string | null;
  quantity: number;
};

export type CustomerCart = {
  id: string;
  items: CustomerCartItem[];
};
