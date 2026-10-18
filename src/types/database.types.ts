export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[]

export type Database = {
  // Allows to automatically instantiate createClient with right options
  // instead of createClient<Database, { PostgrestVersion: 'XX' }>(URL, KEY)
  __InternalSupabase: {
    PostgrestVersion: "14.18"
  }
  public: {
    Tables: {
      income_items: {
        Row: {
          created_at: string
          id: string
          income_receipt_id: string
          product_id: string
          product_name_snapshot: string
          purchase_price_minor: number
          quantity: number
          sku_snapshot: string
          subtotal_minor: number
        }
        Insert: {
          created_at?: string
          id?: string
          income_receipt_id: string
          product_id: string
          product_name_snapshot: string
          purchase_price_minor: number
          quantity: number
          sku_snapshot: string
          subtotal_minor: number
        }
        Update: {
          created_at?: string
          id?: string
          income_receipt_id?: string
          product_id?: string
          product_name_snapshot?: string
          purchase_price_minor?: number
          quantity?: number
          sku_snapshot?: string
          subtotal_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "income_items_income_receipt_id_fkey"
            columns: ["income_receipt_id"]
            isOneToOne: false
            referencedRelation: "income_receipts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "income_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      income_receipts: {
        Row: {
          comment: string | null
          created_at: string
          created_by: string
          created_by_name: string
          id: string
          receipt_number: string
          received_at: string
          status: Database["public"]["Enums"]["document_status"]
          supplier: string
          supplier_document_number: string | null
          total_minor: number
        }
        Insert: {
          comment?: string | null
          created_at?: string
          created_by: string
          created_by_name: string
          id?: string
          receipt_number: string
          received_at: string
          status?: Database["public"]["Enums"]["document_status"]
          supplier: string
          supplier_document_number?: string | null
          total_minor: number
        }
        Update: {
          comment?: string | null
          created_at?: string
          created_by?: string
          created_by_name?: string
          id?: string
          receipt_number?: string
          received_at?: string
          status?: Database["public"]["Enums"]["document_status"]
          supplier?: string
          supplier_document_number?: string | null
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "income_receipts_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_documents: {
        Row: {
          created_at: string
          created_by: string
          created_by_name: string
          document_number: string
          id: string
          occurred_at: string
          reason: Database["public"]["Enums"]["outcome_reason"]
          reason_comment: string | null
          status: Database["public"]["Enums"]["document_status"]
          total_cost_minor: number
        }
        Insert: {
          created_at?: string
          created_by: string
          created_by_name: string
          document_number: string
          id?: string
          occurred_at: string
          reason: Database["public"]["Enums"]["outcome_reason"]
          reason_comment?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          total_cost_minor: number
        }
        Update: {
          created_at?: string
          created_by?: string
          created_by_name?: string
          document_number?: string
          id?: string
          occurred_at?: string
          reason?: Database["public"]["Enums"]["outcome_reason"]
          reason_comment?: string | null
          status?: Database["public"]["Enums"]["document_status"]
          total_cost_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "outcome_documents_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      outcome_items: {
        Row: {
          created_at: string
          id: string
          outcome_document_id: string
          product_id: string
          product_name_snapshot: string
          purchase_price_snapshot_minor: number
          quantity: number
          sku_snapshot: string
          subtotal_minor: number
        }
        Insert: {
          created_at?: string
          id?: string
          outcome_document_id: string
          product_id: string
          product_name_snapshot: string
          purchase_price_snapshot_minor: number
          quantity: number
          sku_snapshot: string
          subtotal_minor: number
        }
        Update: {
          created_at?: string
          id?: string
          outcome_document_id?: string
          product_id?: string
          product_name_snapshot?: string
          purchase_price_snapshot_minor?: number
          quantity?: number
          sku_snapshot?: string
          subtotal_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "outcome_items_outcome_document_id_fkey"
            columns: ["outcome_document_id"]
            isOneToOne: false
            referencedRelation: "outcome_documents"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "outcome_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      product_price_history: {
        Row: {
          created_at: string
          effective_from: string
          id: string
          product_id: string
          purchase_price_minor: number
          selling_price_minor: number
          source: string
        }
        Insert: {
          created_at?: string
          effective_from: string
          id?: string
          product_id: string
          purchase_price_minor: number
          selling_price_minor: number
          source: string
        }
        Update: {
          created_at?: string
          effective_from?: string
          id?: string
          product_id?: string
          purchase_price_minor?: number
          selling_price_minor?: number
          source?: string
        }
        Relationships: [
          {
            foreignKeyName: "product_price_history_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
        ]
      }
      products: {
        Row: {
          barcode: string
          category: string
          category_label: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          min_stock_threshold: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock: number
          updated_at: string
          updated_by: string | null
        }
        Insert: {
          barcode: string
          category: string
          category_label: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          min_stock_threshold?: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock?: number
          updated_at?: string
          updated_by?: string | null
        }
        Update: {
          barcode?: string
          category?: string
          category_label?: string
          created_at?: string
          created_by?: string | null
          description?: string | null
          id?: string
          is_archived?: boolean
          min_stock_threshold?: number
          name?: string
          purchase_price_minor?: number
          selling_price_minor?: number
          sku?: string
          stock?: number
          updated_at?: string
          updated_by?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "products_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "products_updated_by_fkey"
            columns: ["updated_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      profiles: {
        Row: {
          created_at: string
          full_name: string
          id: string
          is_active: boolean
          role: Database["public"]["Enums"]["app_role"]
          updated_at: string
        }
        Insert: {
          created_at?: string
          full_name: string
          id: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Update: {
          created_at?: string
          full_name?: string
          id?: string
          is_active?: boolean
          role?: Database["public"]["Enums"]["app_role"]
          updated_at?: string
        }
        Relationships: []
      }
      sale_items: {
        Row: {
          barcode_snapshot: string | null
          cost_total_minor: number
          created_at: string
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          gross_minor: number
          id: string
          item_discount_minor: number
          net_total_minor: number
          product_id: string
          product_name_snapshot: string
          profit_minor: number
          purchase_price_snapshot_minor: number
          quantity: number
          receipt_discount_allocated_minor: number
          sale_id: string
          selling_price_snapshot_minor: number
          sku_snapshot: string
        }
        Insert: {
          barcode_snapshot?: string | null
          cost_total_minor: number
          created_at?: string
          discount_type: Database["public"]["Enums"]["discount_type"]
          discount_value: number
          gross_minor: number
          id?: string
          item_discount_minor: number
          net_total_minor: number
          product_id: string
          product_name_snapshot: string
          profit_minor: number
          purchase_price_snapshot_minor: number
          quantity: number
          receipt_discount_allocated_minor: number
          sale_id: string
          selling_price_snapshot_minor: number
          sku_snapshot: string
        }
        Update: {
          barcode_snapshot?: string | null
          cost_total_minor?: number
          created_at?: string
          discount_type?: Database["public"]["Enums"]["discount_type"]
          discount_value?: number
          gross_minor?: number
          id?: string
          item_discount_minor?: number
          net_total_minor?: number
          product_id?: string
          product_name_snapshot?: string
          profit_minor?: number
          purchase_price_snapshot_minor?: number
          quantity?: number
          receipt_discount_allocated_minor?: number
          sale_id?: string
          selling_price_snapshot_minor?: number
          sku_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "sale_items_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "sale_items_sale_id_fkey"
            columns: ["sale_id"]
            isOneToOne: false
            referencedRelation: "sales"
            referencedColumns: ["id"]
          },
        ]
      }
      sales: {
        Row: {
          change_minor: number | null
          comment: string | null
          created_at: string
          created_by: string
          created_by_name: string
          id: string
          item_discount_total_minor: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          profit_minor: number
          receipt_discount_minor: number
          receipt_discount_type: Database["public"]["Enums"]["discount_type"]
          receipt_discount_value: number
          receipt_number: string
          received_minor: number | null
          sold_at: string
          status: Database["public"]["Enums"]["document_status"]
          subtotal_minor: number
          total_discount_minor: number
          total_minor: number
        }
        Insert: {
          change_minor?: number | null
          comment?: string | null
          created_at?: string
          created_by: string
          created_by_name: string
          id?: string
          item_discount_total_minor: number
          payment_method: Database["public"]["Enums"]["payment_method"]
          profit_minor: number
          receipt_discount_minor: number
          receipt_discount_type: Database["public"]["Enums"]["discount_type"]
          receipt_discount_value: number
          receipt_number: string
          received_minor?: number | null
          sold_at: string
          status?: Database["public"]["Enums"]["document_status"]
          subtotal_minor: number
          total_discount_minor: number
          total_minor: number
        }
        Update: {
          change_minor?: number | null
          comment?: string | null
          created_at?: string
          created_by?: string
          created_by_name?: string
          id?: string
          item_discount_total_minor?: number
          payment_method?: Database["public"]["Enums"]["payment_method"]
          profit_minor?: number
          receipt_discount_minor?: number
          receipt_discount_type?: Database["public"]["Enums"]["discount_type"]
          receipt_discount_value?: number
          receipt_number?: string
          received_minor?: number | null
          sold_at?: string
          status?: Database["public"]["Enums"]["document_status"]
          subtotal_minor?: number
          total_discount_minor?: number
          total_minor?: number
        }
        Relationships: [
          {
            foreignKeyName: "sales_created_by_fkey"
            columns: ["created_by"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
      stock_movements: {
        Row: {
          balance_after: number
          created_at: string
          id: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note: string | null
          occurred_at: string
          product_id: string
          product_name_snapshot: string
          quantity_delta: number
          reference_id: string | null
          reference_number: string | null
          responsible_id: string | null
          responsible_name: string
          sku_snapshot: string
        }
        Insert: {
          balance_after: number
          created_at?: string
          id?: string
          movement_type: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          occurred_at: string
          product_id: string
          product_name_snapshot: string
          quantity_delta: number
          reference_id?: string | null
          reference_number?: string | null
          responsible_id?: string | null
          responsible_name: string
          sku_snapshot: string
        }
        Update: {
          balance_after?: number
          created_at?: string
          id?: string
          movement_type?: Database["public"]["Enums"]["movement_type"]
          note?: string | null
          occurred_at?: string
          product_id?: string
          product_name_snapshot?: string
          quantity_delta?: number
          reference_id?: string | null
          reference_number?: string | null
          responsible_id?: string | null
          responsible_name?: string
          sku_snapshot?: string
        }
        Relationships: [
          {
            foreignKeyName: "stock_movements_product_id_fkey"
            columns: ["product_id"]
            isOneToOne: false
            referencedRelation: "products"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "stock_movements_responsible_id_fkey"
            columns: ["responsible_id"]
            isOneToOne: false
            referencedRelation: "profiles"
            referencedColumns: ["id"]
          },
        ]
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      rpc_adjust_product_stock: {
        Args: { p_new_stock: number; p_product_id: string; p_reason: string }
        Returns: {
          barcode: string
          category: string
          category_label: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          min_stock_threshold: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_archive_product: {
        Args: { p_is_archived?: boolean; p_product_id: string }
        Returns: {
          barcode: string
          category: string
          category_label: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          min_stock_threshold: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_create_income_receipt: {
        Args: {
          p_comment?: string
          p_id?: string
          p_items?: Json
          p_received_at?: string
          p_supplier: string
          p_supplier_document_number?: string
        }
        Returns: Json
      }
      rpc_create_outcome_document: {
        Args: {
          p_id?: string
          p_items?: Json
          p_occurred_at?: string
          p_reason: Database["public"]["Enums"]["outcome_reason"]
          p_reason_comment?: string
        }
        Returns: Json
      }
      rpc_create_product: {
        Args: {
          p_barcode: string
          p_category: string
          p_category_label: string
          p_description?: string
          p_min_stock_threshold?: number
          p_name: string
          p_purchase_price_minor: number
          p_selling_price_minor: number
          p_sku: string
          p_stock?: number
        }
        Returns: {
          barcode: string
          category: string
          category_label: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          min_stock_threshold: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
      rpc_create_sale: {
        Args: {
          p_comment?: string
          p_id?: string
          p_items?: Json
          p_payment_method: Database["public"]["Enums"]["payment_method"]
          p_receipt_discount_type?: Database["public"]["Enums"]["discount_type"]
          p_receipt_discount_value?: number
          p_received_minor?: number
          p_sold_at?: string
        }
        Returns: Json
      }
      rpc_get_dashboard_sales_summary: {
        Args: {
          p_day_bounds: string[]
          p_popular_limit?: number
          p_recent_limit?: number
        }
        Returns: Json
      }
      rpc_get_dashboard_stock_summary: {
        Args: { p_low_stock_limit?: number }
        Returns: Json
      }
      rpc_update_product: {
        Args: {
          p_barcode: string
          p_category: string
          p_category_label: string
          p_description?: string
          p_min_stock_threshold?: number
          p_name: string
          p_product_id: string
          p_purchase_price_minor: number
          p_selling_price_minor: number
          p_sku: string
        }
        Returns: {
          barcode: string
          category: string
          category_label: string
          created_at: string
          created_by: string | null
          description: string | null
          id: string
          is_archived: boolean
          min_stock_threshold: number
          name: string
          purchase_price_minor: number
          selling_price_minor: number
          sku: string
          stock: number
          updated_at: string
          updated_by: string | null
        }
        SetofOptions: {
          from: "*"
          to: "products"
          isOneToOne: true
          isSetofReturn: false
        }
      }
    }
    Enums: {
      app_role: "admin" | "cashier"
      discount_type: "none" | "fixed" | "percent"
      document_status: "completed"
      movement_type:
        | "opening_balance"
        | "income"
        | "sale"
        | "write_off"
        | "inventory_adjustment"
      outcome_reason:
        | "damaged"
        | "defective"
        | "lost"
        | "internal_use"
        | "other"
      payment_method: "cash" | "card" | "transfer"
    }
    CompositeTypes: {
      [_ in never]: never
    }
  }
}

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">]

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
      DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])[TableName] extends {
      Row: infer R
    }
    ? R
    : never
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
        Row: infer R
      }
      ? R
      : never
    : never

export type TablesInsert<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Insert: infer I
    }
    ? I
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Insert: infer I
      }
      ? I
      : never
    : never

export type TablesUpdate<
  DefaultSchemaTableNameOrOptions extends
    | keyof DefaultSchema["Tables"]
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends (DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never) = never,
> = DefaultSchemaTableNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"][TableName] extends {
      Update: infer U
    }
    ? U
    : never
  : DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"]
    ? DefaultSchema["Tables"][DefaultSchemaTableNameOrOptions] extends {
        Update: infer U
      }
      ? U
      : never
    : never

export type Enums<
  DefaultSchemaEnumNameOrOptions extends
    | keyof DefaultSchema["Enums"]
    | { schema: keyof DatabaseWithoutInternals },
  EnumName extends (DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never) = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never) = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {
      app_role: ["admin", "cashier"],
      discount_type: ["none", "fixed", "percent"],
      document_status: ["completed"],
      movement_type: [
        "opening_balance",
        "income",
        "sale",
        "write_off",
        "inventory_adjustment",
      ],
      outcome_reason: ["damaged", "defective", "lost", "internal_use", "other"],
      payment_method: ["cash", "card", "transfer"],
    },
  },
} as const
