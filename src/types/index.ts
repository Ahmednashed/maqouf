// ─── Locale ──────────────────────────────────────────────────────────────────
export type Locale = "ar" | "en";
export type Dir   = "rtl" | "ltr";

// ─── Roles ───────────────────────────────────────────────────────────────────
export type UserRole = "owner" | "admin" | "merchandiser";

// ─── Company / Subscription ──────────────────────────────────────────────────
export type SubscriptionPlan   = "starter" | "growth" | "business" | "enterprise";
export type SubscriptionStatus = "trialing" | "active" | "past_due" | "canceled";

export interface Company {
  id:                 string;
  name:               string;
  slug:               string;
  logo_url?:          string;
  subscription_plan:  SubscriptionPlan;
  subscription_status:SubscriptionStatus;
  trial_ends_at?:     string;
  max_users:          number;
  created_at:         string;
  updated_at:         string;
}

// ─── User ─────────────────────────────────────────────────────────────────────
export interface User {
  id:           string;
  email:        string;
  full_name:    string;
  avatar_url?:  string;
  phone?:       string;
  created_at:   string;
  updated_at:   string;
}

export interface CompanyUser {
  id:               string;
  company_id:       string;
  user_id:          string;
  role:             UserRole;
  emp_id?:          string;
  region?:          string;
  color?:           string;    // avatar / badge colour — DB default '#6366F1'
  status:           "active" | "inactive";
  invited_by?:      string;
  // Cached display info (migration 011) — survives auth-user deletion
  display_name?:    string | null;
  display_email?:   string | null;
  // Company-level avatar override (migration 011)
  avatar_url?:      string | null;
  // Mobile app sync timestamp (migration 011)
  last_mobile_sync?: string | null;
  // Denormalised last-activity from visits (migration 011)
  last_activity_at?: string | null;
  created_at:       string;
  updated_at:       string;
  // joined
  user?:            User;
  company?:         Company;
}

// ─── Chain ────────────────────────────────────────────────────────────────────
export interface Chain {
  id:           string;
  company_id:   string;
  name_ar:      string;
  name_en:      string;
  logo_url?:    string;
  color?:       string;
  code:         string;
  is_active:    boolean;
  created_at:   string;
  updated_at:   string;
}

// ─── Place ────────────────────────────────────────────────────────────────────
export interface Place {
  id:               string;
  company_id:       string;
  chain_id:         string;
  branch_ar:        string;
  branch_en:        string;
  code:             string;
  address_ar?:      string;
  address_en?:      string;
  city_ar?:         string;
  city_en?:         string;
  region?:          string;
  lat?:             number;
  lng?:             number;
  assigned_user_id?: string;
  is_active:        boolean;
  created_at:       string;
  updated_at:       string;
  // joined
  chain?:           Chain;
  assigned_user?:   CompanyUser;
  products?:        PlaceProduct[];
}

export interface PlaceProduct {
  place_id:         string;
  product_id:       string;
  is_mandatory:     boolean;
  min_stock:        number;
  display_priority: number;
  is_active:        boolean;
  created_at:       string;
  product?:         Product;
}

// ─── Product ──────────────────────────────────────────────────────────────────
export type ProductCategory = "beverages" | "snacks" | "dairy" | "bakery" | "frozen";
export type ProductUnit      = "piece" | "box" | "carton" | "kg" | "liter";

export interface Product {
  id:           string;
  company_id:   string;
  sku:          string;
  name_ar:      string;
  name_en:      string;
  category:     ProductCategory;
  unit:         ProductUnit;
  cost?:        number;
  price?:       number;
  stock:        number;
  image_url?:   string;
  is_active:    boolean;
  created_at:   string;
  updated_at:   string;
}

// ─── Visit ────────────────────────────────────────────────────────────────────
export type VisitStatus = "pending" | "inprogress" | "completed" | "missed";

export interface Visit {
  id:               string;
  company_id:       string;
  place_id:         string;
  merch_id:         string;
  template_id?:     string;
  status:           VisitStatus;
  scheduled_date:   string;
  started_at?:      string;
  completed_at?:    string;
  duration_minutes: number;
  notes?:           string;
  lat?:             number;
  lng?:             number;
  created_at:       string;
  updated_at:       string;
  // ── GPS check-in (migration 009) ──────────────────────────────────────────
  checkin_lat?:             number | null;
  checkin_lng?:             number | null;
  checkin_accuracy?:        number | null;  // device-reported accuracy in metres
  checkin_distance_meters?: number | null;  // Haversine distance to branch
  checkin_verified?:        boolean | null; // true → distance ≤ 200 m
  // joined
  place?:           Place;
  merch?:           CompanyUser;
  checked_products?: VisitProduct[];
}

export interface VisitProduct {
  visit_id:    string;
  product_id:  string;
  qty_found?:  number;
  qty_missing?:number;
  notes?:      string;
  created_at:  string;
  product?:    Product;
}

// ─── Schedule ─────────────────────────────────────────────────────────────────
export type DayOfWeek        = 0|1|2|3|4|5|6; // 0=Sun…6=Sat
export type ScheduleFrequency = "weekly" | "biweekly" | "monthly";

export interface Schedule {
  id:           string;
  company_id:   string;
  merch_id:     string;
  place_id:     string;
  day_of_week:  DayOfWeek;
  start_time:   string; // "HH:mm"
  end_time?:    string;
  frequency:    ScheduleFrequency;
  is_active:    boolean;
  created_at:   string;
  // joined
  merch?:       CompanyUser;
  place?:       Place;
}

// ─── Template ─────────────────────────────────────────────────────────────────
export type FieldType =
  | "text" | "numeric" | "yesno" | "single" | "multiple"
  | "photo" | "photos" | "date" | "section" | "barcode"
  | "product" | "matrix"
  | "location";  // GPS capture field — rendered in builder, execution TBD

/** Legacy minimal shape (kept for backward compat with existing join types). */
export interface TemplateField {
  id:       string;
  type:     FieldType;
  label:    string;
  required: boolean;
  order:    number;
  options?: string[];
}

/**
 * Full DB row from the template_fields table.
 * Bilingual labels, sort_order, optional per-field help text,
 * and an options array for single/multiple choice fields.
 *
 * Future GPS response shape (stored in visit_responses, not here):
 *   { latitude: number; longitude: number; accuracy?: number; captured_at: string }
 */
export interface TemplateFieldFull {
  id:            string;
  template_id:   string;
  company_id:    string;
  type:          FieldType;
  label_ar:      string;
  label_en:      string;
  required:      boolean;
  sort_order:    number;
  options:       string[] | null;
  help_text_ar:  string | null;
  help_text_en:  string | null;
  created_at:    string;
  updated_at:    string;
}

export interface Template {
  id:           string;
  company_id:   string;
  name_ar:      string;
  name_en:      string;
  description?: string;
  fields:       TemplateField[];
  status:       "active" | "draft";
  usage_count:  number;
  created_by:   string;
  created_at:   string;
  updated_at:   string;
}

/** Template enriched with full field rows — used by the builder page. */
export interface TemplateWithFields extends Omit<Template, "fields"> {
  fields: TemplateFieldFull[];
}

/** Lightweight list item — includes field count but not full field data. */
export interface TemplateListItem extends Omit<Template, "fields"> {
  field_count: number;
}

// ─── Expiring Product ─────────────────────────────────────────────────────────
export interface ExpiringProduct {
  id:           string;
  company_id:   string;
  place_id:     string;
  product_id:   string;
  batch:        string;
  qty:          number;
  expiry_date:  string;
  days_left:    number;
  created_at:   string;
  // joined
  place?:       Place;
  product?:     Product;
}

// ─── Activity log (migration 012) ─────────────────────────────────────────────

/** Actions recorded by DB triggers + client-side logging. */
export type ActivityAction =
  | "visit.created"
  | "visit.started"
  | "visit.completed"
  | "visit.missed"
  | "user.activated"
  | "user.deactivated"
  | "user.role_changed"
  | "user.invited"
  | "user.updated";

export type ActivityEntityType = "visit" | "user" | "place" | "product";

export interface ActivityLog {
  id:           string;
  company_id:   string;
  actor_id:     string | null;
  actor_name:   string | null;
  action:       ActivityAction | string;   // string fallback for future actions
  entity_type:  ActivityEntityType | string;
  entity_id:    string | null;
  entity_label: string | null;
  details:      Record<string, unknown> | null;
  created_at:   string;
}

// ─── UI helpers ───────────────────────────────────────────────────────────────
export interface SelectOption {
  value: string;
  label: string;
}

export type SortDir = "asc" | "desc";

export interface PaginationMeta {
  page:       number;
  page_size:  number;
  total:      number;
  total_pages:number;
}
