/**
 * Manual Supabase Database types for P0/P1 (+ P2 text ids / soft-delete).
 * Regenerate with `supabase gen types typescript` once the CLI is linked.
 */

export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

type SoftDeleteCols = {
  deleted_at?: string | null;
  deleted_by?: string | null;
  deleted_reason?: string | null;
};

export type Database = {
  __InternalSupabase: {
    PostgrestVersion: "14.5";
  };
  public: {
    Tables: {
      warehouses: {
        Row: {
          id: string;
          code: string;
          name: string;
          location: string | null;
          active: boolean;
          created_at: string;
        } & SoftDeleteCols;
        Insert: {
          id?: string;
          code: string;
          name: string;
          location?: string | null;
          active?: boolean;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deleted_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["warehouses"]["Insert"]>;
        Relationships: [];
      };
      products: {
        Row: {
          id: string;
          sku: string;
          name: string;
          unit: string;
          category: string | null;
          active: boolean;
          created_at: string;
        } & SoftDeleteCols;
        Insert: {
          id?: string;
          sku: string;
          name: string;
          unit?: string;
          category?: string | null;
          active?: boolean;
          created_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deleted_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["products"]["Insert"]>;
        Relationships: [];
      };
      stock_balances: {
        Row: {
          id: string;
          product_id: string;
          warehouse_id: string;
          physical_qty: number;
          reserved_qty: number;
        };
        Insert: {
          id?: string;
          product_id: string;
          warehouse_id: string;
          physical_qty?: number;
          reserved_qty?: number;
        };
        Update: Partial<Database["public"]["Tables"]["stock_balances"]["Insert"]>;
        Relationships: [];
      };
      customers: {
        Row: {
          id: string;
          code: string;
          name: string;
          category: string;
          contact_name: string | null;
          phone: string | null;
          email: string | null;
          address: string | null;
          tin: string | null;
          credit_limit: number;
          payment_terms: string;
          notes: string | null;
          active: boolean;
          created_at: string;
          updated_at: string;
        } & SoftDeleteCols;
        Insert: {
          id?: string;
          code: string;
          name: string;
          category: string;
          contact_name?: string | null;
          phone?: string | null;
          email?: string | null;
          address?: string | null;
          tin?: string | null;
          credit_limit?: number;
          payment_terms?: string;
          notes?: string | null;
          active?: boolean;
          created_at?: string;
          updated_at?: string;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deleted_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["customers"]["Insert"]>;
        Relationships: [];
      };
      customer_purchase_orders: {
        Row: {
          id: string;
          number: string;
          customer_id: string;
          status: string;
          order_date: string;
          required_date: string | null;
          notes: string | null;
          confirmed_at: string | null;
          cancelled_at: string | null;
          cancel_reason: string | null;
          created_by: string | null;
          created_at: string;
          updated_at: string;
          customer_po_number: string | null;
        } & SoftDeleteCols;
        Insert: {
          id?: string;
          number: string;
          customer_id: string;
          status: string;
          order_date?: string;
          required_date?: string | null;
          notes?: string | null;
          confirmed_at?: string | null;
          cancelled_at?: string | null;
          cancel_reason?: string | null;
          created_by?: string | null;
          created_at?: string;
          updated_at?: string;
          customer_po_number?: string | null;
          deleted_at?: string | null;
          deleted_by?: string | null;
          deleted_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["customer_purchase_orders"]["Insert"]>;
        Relationships: [];
      };
      customer_order_lines: {
        Row: {
          id: string;
          order_id: string;
          product_id: string;
          warehouse_id: string;
          ordered_qty: number;
          supplied_qty: number;
          cancelled_qty: number;
          reserved_qty: number;
          unit_price: number;
          line_status: string;
          cancel_reason: string | null;
          cancelled_at: string | null;
          cancelled_by: string | null;
        };
        Insert: {
          id?: string;
          order_id: string;
          product_id: string;
          warehouse_id: string;
          ordered_qty: number;
          supplied_qty?: number;
          cancelled_qty?: number;
          reserved_qty?: number;
          unit_price?: number;
          line_status: string;
          cancel_reason?: string | null;
          cancelled_at?: string | null;
          cancelled_by?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["customer_order_lines"]["Insert"]>;
        Relationships: [];
      };
      supplies: {
        Row: {
          id: string;
          number: string;
          order_id: string;
          supplied_at: string;
          supplied_by: string;
          notes: string | null;
        };
        Insert: {
          id?: string;
          number: string;
          order_id: string;
          supplied_at?: string;
          supplied_by: string;
          notes?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["supplies"]["Insert"]>;
        Relationships: [];
      };
      supply_lines: {
        Row: {
          id: string;
          supply_id: string;
          order_line_id: string;
          product_id: string;
          warehouse_id: string;
          quantity: number;
        };
        Insert: {
          id?: string;
          supply_id: string;
          order_line_id: string;
          product_id: string;
          warehouse_id: string;
          quantity: number;
        };
        Update: Partial<Database["public"]["Tables"]["supply_lines"]["Insert"]>;
        Relationships: [];
      };
      audit_events: {
        Row: {
          id: string;
          at: string;
          actor: string;
          action: string;
          entity_type: string;
          entity_id: string;
          summary: string;
          meta: Json | null;
        };
        Insert: {
          id?: string;
          at?: string;
          actor: string;
          action: string;
          entity_type: string;
          entity_id: string;
          summary: string;
          meta?: Json | null;
        };
        Update: Partial<Database["public"]["Tables"]["audit_events"]["Insert"]>;
        Relationships: [];
      };
      document_counters: {
        Row: {
          id: number;
          order_seq: number;
          supply_seq: number;
          customer_seq: number;
          invoice_seq: number;
          receipt_seq: number;
          delivery_seq: number;
          payment_seq: number;
        };
        Insert: {
          id?: number;
          order_seq?: number;
          supply_seq?: number;
          customer_seq?: number;
          invoice_seq?: number;
          receipt_seq?: number;
          delivery_seq?: number;
          payment_seq?: number;
        };
        Update: Partial<Database["public"]["Tables"]["document_counters"]["Insert"]>;
        Relationships: [];
      };
      app_settings: {
        Row: {
          key: string;
          value: Json;
        };
        Insert: {
          key: string;
          value: Json;
        };
        Update: Partial<Database["public"]["Tables"]["app_settings"]["Insert"]>;
        Relationships: [];
      };
      vat_rates: {
        Row: {
          id: string;
          code: string;
          label: string;
          rate_percent: number;
          active: boolean;
          created_at: string;
        };
        Insert: {
          id?: string;
          code: string;
          label: string;
          rate_percent?: number;
          active?: boolean;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["vat_rates"]["Insert"]>;
        Relationships: [];
      };
      invoices: {
        Row: {
          id: string;
          number: string;
          customer_id: string;
          order_id: string;
          supply_id: string | null;
          invoice_date: string;
          customer_po_number: string | null;
          customer_tin: string | null;
          billing_address: string | null;
          vat_rate_id: string | null;
          subtotal: number;
          vat_amount: number;
          total: number;
          payment_status: string;
          amount_paid: number;
          prepared_by: string;
          notes: string | null;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          number: string;
          customer_id: string;
          order_id: string;
          supply_id?: string | null;
          invoice_date?: string;
          customer_po_number?: string | null;
          customer_tin?: string | null;
          billing_address?: string | null;
          vat_rate_id?: string | null;
          subtotal?: number;
          vat_amount?: number;
          total?: number;
          payment_status?: string;
          amount_paid?: number;
          prepared_by: string;
          notes?: string | null;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["invoices"]["Insert"]>;
        Relationships: [];
      };
      invoice_lines: {
        Row: {
          id: string;
          invoice_id: string;
          product_id: string;
          description: string;
          quantity: number;
          unit_price: number;
          line_subtotal: number;
          vat_rate_id: string | null;
          vat_amount: number;
          line_total: number;
          order_line_id: string | null;
          supply_line_id: string | null;
        };
        Insert: {
          id?: string;
          invoice_id: string;
          product_id: string;
          description: string;
          quantity: number;
          unit_price?: number;
          line_subtotal?: number;
          vat_rate_id?: string | null;
          vat_amount?: number;
          line_total?: number;
          order_line_id?: string | null;
          supply_line_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["invoice_lines"]["Insert"]>;
        Relationships: [];
      };
      receipts: {
        Row: {
          id: string;
          number: string;
          customer_id: string;
          order_id: string | null;
          invoice_id: string | null;
          receipt_date: string;
          payment_method: string;
          amount: number;
          amount_paid: number;
          balance: number;
          processed_by: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          number: string;
          customer_id: string;
          order_id?: string | null;
          invoice_id?: string | null;
          receipt_date?: string;
          payment_method: string;
          amount?: number;
          amount_paid?: number;
          balance?: number;
          processed_by: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["receipts"]["Insert"]>;
        Relationships: [];
      };
      receipt_lines: {
        Row: {
          id: string;
          receipt_id: string;
          product_id: string | null;
          description: string;
          quantity: number;
          unit_price: number;
          line_total: number;
        };
        Insert: {
          id?: string;
          receipt_id: string;
          product_id?: string | null;
          description: string;
          quantity?: number;
          unit_price?: number;
          line_total?: number;
        };
        Update: Partial<Database["public"]["Tables"]["receipt_lines"]["Insert"]>;
        Relationships: [];
      };
      deliveries: {
        Row: {
          id: string;
          number: string;
          customer_id: string;
          order_id: string;
          supply_id: string;
          delivery_date: string;
          address: string;
          method: string;
          vehicle: string | null;
          driver: string | null;
          receiver_name: string | null;
          receiver_contact: string | null;
          status: string;
          confirmed_at: string | null;
          confirmed_by: string | null;
          notes: string | null;
          created_by: string;
          created_at: string;
          updated_at: string;
        };
        Insert: {
          id?: string;
          number: string;
          customer_id: string;
          order_id: string;
          supply_id: string;
          delivery_date?: string;
          address: string;
          method: string;
          vehicle?: string | null;
          driver?: string | null;
          receiver_name?: string | null;
          receiver_contact?: string | null;
          status: string;
          confirmed_at?: string | null;
          confirmed_by?: string | null;
          notes?: string | null;
          created_by: string;
          created_at?: string;
          updated_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["deliveries"]["Insert"]>;
        Relationships: [];
      };
      delivery_items: {
        Row: {
          id: string;
          delivery_id: string;
          product_id: string;
          quantity: number;
          supply_line_id: string | null;
          order_line_id: string | null;
        };
        Insert: {
          id?: string;
          delivery_id: string;
          product_id: string;
          quantity: number;
          supply_line_id?: string | null;
          order_line_id?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["delivery_items"]["Insert"]>;
        Relationships: [];
      };
      payments: {
        Row: {
          id: string;
          number: string;
          customer_id: string;
          order_id: string | null;
          invoice_id: string | null;
          receipt_id: string | null;
          payment_date: string;
          method: string;
          amount: number;
          reference: string | null;
          recorded_by: string;
          notes: string | null;
          created_at: string;
        };
        Insert: {
          id?: string;
          number: string;
          customer_id: string;
          order_id?: string | null;
          invoice_id?: string | null;
          receipt_id?: string | null;
          payment_date?: string;
          method: string;
          amount: number;
          reference?: string | null;
          recorded_by: string;
          notes?: string | null;
          created_at?: string;
        };
        Update: Partial<Database["public"]["Tables"]["payments"]["Insert"]>;
        Relationships: [];
      };
      notifications: {
        Row: {
          id: string;
          type: string;
          title: string;
          body: string;
          order_id: string | null;
          product_id: string | null;
          dedupe_key: string;
          created_at: string;
          read_at: string | null;
        };
        Insert: {
          id?: string;
          type: string;
          title: string;
          body: string;
          order_id?: string | null;
          product_id?: string | null;
          dedupe_key: string;
          created_at?: string;
          read_at?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["notifications"]["Insert"]>;
        Relationships: [];
      };
      stock_reservations: {
        Row: {
          id: string;
          order_line_id: string;
          product_id: string;
          warehouse_id: string;
          quantity: number;
          reserved_at: string;
          reserved_by: string;
          expires_at: string | null;
          released_at: string | null;
          release_reason: string | null;
        };
        Insert: {
          id?: string;
          order_line_id: string;
          product_id: string;
          warehouse_id: string;
          quantity: number;
          reserved_at?: string;
          reserved_by: string;
          expires_at?: string | null;
          released_at?: string | null;
          release_reason?: string | null;
        };
        Update: Partial<Database["public"]["Tables"]["stock_reservations"]["Insert"]>;
        Relationships: [];
      };
    };
    Views: {
      v_outstanding_customer_supplies: {
        Row: {
          order_id: string | null;
          order_number: string | null;
          order_status: string | null;
          order_date: string | null;
          confirmed_at: string | null;
          customer_id: string | null;
          customer_name: string | null;
          line_id: string | null;
          product_id: string | null;
          product_name: string | null;
          product_sku: string | null;
          warehouse_id: string | null;
          warehouse_name: string | null;
          ordered_qty: number | null;
          supplied_qty: number | null;
          cancelled_qty: number | null;
          outstanding_qty: number | null;
          reserved_qty: number | null;
          available_qty: number | null;
          line_status: string | null;
          unit_price: number | null;
        };
        Relationships: [];
      };
      tlb_inventory_movements: {
        Row: {
          id: string;
          movement_number: string;
          movement_type: string;
          direction: number;
          quantity: number;
          product_id: string;
          warehouse_id: string;
          batch_id: string | null;
          qty_before: number;
          qty_after: number;
          reason: string | null;
          reference_type: string | null;
          reference_id: string | null;
          reference_number: string | null;
          notes: string | null;
          actor_id: string | null;
          created_at: string;
        };
        Relationships: [];
      };
      tlb_inventory_balances: {
        Row: {
          product_id: string;
          warehouse_id: string;
          quantity_on_hand: number;
          quantity_reserved: number;
          quantity_damaged: number;
          quantity_expired: number;
          quantity_quarantine: number;
          quantity_in_transit: number;
          quantity_allocated: number;
          created_at: string;
          updated_at: string;
        };
        Relationships: [];
      };
    };
    Functions: {
      ensure_ledger_ref: {
        Args: {
          p_product_key: string;
          p_sku: string;
          p_product_name: string;
          p_unit: string;
          p_issue_strategy?: string | null;
          p_warehouse_key: string;
          p_warehouse_code: string;
          p_warehouse_name: string;
          p_warehouse_location?: string | null;
        };
        Returns: Json;
      };
      issue_document_number: {
        Args: { p_document_type: string };
        Returns: string;
      };
      post_movement: {
        Args: {
          p_movement_type: string;
          p_product_id: string;
          p_warehouse_id: string;
          p_quantity: number;
          p_batch_id?: string | null;
          p_reason?: string | null;
          p_reference_type?: string | null;
          p_reference_id?: string | null;
          p_reference_number?: string | null;
          p_notes?: string | null;
        };
        Returns: Json;
      };
    };
    Enums: Record<string, never>;
    CompositeTypes: Record<string, never>;
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;
type DefaultSchema = DatabaseWithoutInternals[Extract<keyof DatabaseWithoutInternals, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R;
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] & DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R;
      }
      ? R
      : never
    : never;

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I;
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I;
      }
      ? I
      : never
    : never;

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U;
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U;
      }
      ? U
      : never
    : never;

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    keyof DefaultSchema["CompositeTypes"] | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  public: {
    Enums: {},
  },
} as const;
