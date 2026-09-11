export type Json = string | number | boolean | null | { [key: string]: Json | undefined } | Json[];

export type Database = {
  graphql_public: {
    Tables: {
      [_ in never]: never;
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      graphql: {
        Args: {
          extensions?: Json;
          operationName?: string;
          query?: string;
          variables?: Json;
        };
        Returns: Json;
      };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
  public: {
    Tables: {
      activity_log: {
        Row: {
          channel_account_id: string | null;
          context: Json;
          created_at: string;
          id: string;
          level: string;
          message: string;
          sku_id: string | null;
          workspace_id: string;
        };
        Insert: {
          channel_account_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          level?: string;
          message: string;
          sku_id?: string | null;
          workspace_id: string;
        };
        Update: {
          channel_account_id?: string | null;
          context?: Json;
          created_at?: string;
          id?: string;
          level?: string;
          message?: string;
          sku_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "activity_log_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "activity_log_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ai_permissions: {
        Row: {
          bounds: Json;
          capability: string;
          level: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          bounds?: Json;
          capability: string;
          level?: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          bounds?: Json;
          capability?: string;
          level?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ai_permissions_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      analyst_digests: {
        Row: {
          created_at: string;
          findings: Json;
          id: string;
          model: string | null;
          opened_at: string | null;
          period_end: string;
          period_start: string;
          sent_at: string | null;
          summary: string | null;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          findings?: Json;
          id?: string;
          model?: string | null;
          opened_at?: string | null;
          period_end: string;
          period_start: string;
          sent_at?: string | null;
          summary?: string | null;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          findings?: Json;
          id?: string;
          model?: string | null;
          opened_at?: string | null;
          period_end?: string;
          period_start?: string;
          sent_at?: string | null;
          summary?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "analyst_digests_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      audit_events: {
        Row: {
          action: string;
          actor_user_id: string | null;
          after_hash: string | null;
          before_hash: string | null;
          created_at: string;
          id: string;
          ip: unknown;
          object_id: string | null;
          object_type: string;
          user_agent: string | null;
          workspace_id: string;
        };
        Insert: {
          action: string;
          actor_user_id?: string | null;
          after_hash?: string | null;
          before_hash?: string | null;
          created_at?: string;
          id?: string;
          ip?: unknown;
          object_id?: string | null;
          object_type: string;
          user_agent?: string | null;
          workspace_id: string;
        };
        Update: {
          action?: string;
          actor_user_id?: string | null;
          after_hash?: string | null;
          before_hash?: string | null;
          created_at?: string;
          id?: string;
          ip?: unknown;
          object_id?: string | null;
          object_type?: string;
          user_agent?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "audit_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_accounts: {
        Row: {
          account_settings: Json;
          channel: string;
          created_at: string;
          credentials_ciphertext: string | null;
          credentials_key_id: string | null;
          deleted_at: string | null;
          display_name: string;
          external_account_id: string;
          id: string;
          last_health_check_at: string | null;
          last_inbound_at: string | null;
          last_outbound_at: string | null;
          marketplace: string;
          scopes: string[];
          status: string;
          sync_enabled: boolean;
          token_expires_at: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          account_settings?: Json;
          channel: string;
          created_at?: string;
          credentials_ciphertext?: string | null;
          credentials_key_id?: string | null;
          deleted_at?: string | null;
          display_name: string;
          external_account_id: string;
          id?: string;
          last_health_check_at?: string | null;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          marketplace: string;
          scopes?: string[];
          status?: string;
          sync_enabled?: boolean;
          token_expires_at?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          account_settings?: Json;
          channel?: string;
          created_at?: string;
          credentials_ciphertext?: string | null;
          credentials_key_id?: string | null;
          deleted_at?: string | null;
          display_name?: string;
          external_account_id?: string;
          id?: string;
          last_health_check_at?: string | null;
          last_inbound_at?: string | null;
          last_outbound_at?: string | null;
          marketplace?: string;
          scopes?: string[];
          status?: string;
          sync_enabled?: boolean;
          token_expires_at?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_accounts_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_category_mappings: {
        Row: {
          aspect_defaults: Json;
          category_path: string;
          channel: string;
          created_at: string;
          external_category_id: string;
          id: string;
          workspace_id: string;
        };
        Insert: {
          aspect_defaults?: Json;
          category_path: string;
          channel: string;
          created_at?: string;
          external_category_id: string;
          id?: string;
          workspace_id: string;
        };
        Update: {
          aspect_defaults?: Json;
          category_path?: string;
          channel?: string;
          created_at?: string;
          external_category_id?: string;
          id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_category_mappings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_events: {
        Row: {
          channel: string;
          channel_account_id: string | null;
          error: Json | null;
          external_event_id: string;
          id: string;
          payload: Json;
          processed_at: string | null;
          received_at: string;
          signature_valid: boolean;
          status: string;
          topic: string;
          workspace_id: string | null;
        };
        Insert: {
          channel: string;
          channel_account_id?: string | null;
          error?: Json | null;
          external_event_id: string;
          id?: string;
          payload: Json;
          processed_at?: string | null;
          received_at?: string;
          signature_valid?: boolean;
          status?: string;
          topic: string;
          workspace_id?: string | null;
        };
        Update: {
          channel?: string;
          channel_account_id?: string | null;
          error?: Json | null;
          external_event_id?: string;
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          received_at?: string;
          signature_valid?: boolean;
          status?: string;
          topic?: string;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "channel_events_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_listings: {
        Row: {
          applied_ledger_seq: number;
          channel_account_id: string;
          channel_payload: Json;
          created_at: string;
          desired_quantity: number;
          external_ids: Json;
          external_listing_id: string;
          id: string;
          last_error: Json | null;
          listing_model: string | null;
          managed: boolean;
          price_minor: number | null;
          pushed_at: string | null;
          pushed_quantity: number | null;
          remote_checked_at: string | null;
          remote_quantity: number | null;
          sku_id: string | null;
          status: string;
          title_snapshot: string | null;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          applied_ledger_seq?: number;
          channel_account_id: string;
          channel_payload?: Json;
          created_at?: string;
          desired_quantity?: number;
          external_ids?: Json;
          external_listing_id: string;
          id?: string;
          last_error?: Json | null;
          listing_model?: string | null;
          managed?: boolean;
          price_minor?: number | null;
          pushed_at?: string | null;
          pushed_quantity?: number | null;
          remote_checked_at?: string | null;
          remote_quantity?: number | null;
          sku_id?: string | null;
          status?: string;
          title_snapshot?: string | null;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          applied_ledger_seq?: number;
          channel_account_id?: string;
          channel_payload?: Json;
          created_at?: string;
          desired_quantity?: number;
          external_ids?: Json;
          external_listing_id?: string;
          id?: string;
          last_error?: Json | null;
          listing_model?: string | null;
          managed?: boolean;
          price_minor?: number | null;
          pushed_at?: string | null;
          pushed_quantity?: number | null;
          remote_checked_at?: string | null;
          remote_quantity?: number | null;
          sku_id?: string | null;
          status?: string;
          title_snapshot?: string | null;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "channel_listings_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_listings_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "channel_listings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      channel_taxonomies: {
        Row: {
          channel: string;
          fetched_at: string;
          id: string;
          marketplace: string;
          payload: Json;
          version: string;
        };
        Insert: {
          channel: string;
          fetched_at?: string;
          id?: string;
          marketplace: string;
          payload: Json;
          version: string;
        };
        Update: {
          channel?: string;
          fetched_at?: string;
          id?: string;
          marketplace?: string;
          payload?: Json;
          version?: string;
        };
        Relationships: [];
      };
      connector_switches: {
        Row: {
          channel: string;
          note: string | null;
          pull_enabled: boolean;
          push_enabled: boolean;
          updated_at: string;
          webhooks_enabled: boolean;
        };
        Insert: {
          channel: string;
          note?: string | null;
          pull_enabled?: boolean;
          push_enabled?: boolean;
          updated_at?: string;
          webhooks_enabled?: boolean;
        };
        Update: {
          channel?: string;
          note?: string | null;
          pull_enabled?: boolean;
          push_enabled?: boolean;
          updated_at?: string;
          webhooks_enabled?: boolean;
        };
        Relationships: [];
      };
      deletion_requests: {
        Row: {
          channel: string;
          completed_at: string | null;
          evidence: Json;
          external_user_id: string;
          id: string;
          received_at: string;
          workspace_ids: string[];
        };
        Insert: {
          channel: string;
          completed_at?: string | null;
          evidence?: Json;
          external_user_id: string;
          id?: string;
          received_at?: string;
          workspace_ids?: string[];
        };
        Update: {
          channel?: string;
          completed_at?: string | null;
          evidence?: Json;
          external_user_id?: string;
          id?: string;
          received_at?: string;
          workspace_ids?: string[];
        };
        Relationships: [];
      };
      fee_schedules: {
        Row: {
          account_type: string | null;
          channel: string;
          created_at: string;
          effective_from: string;
          effective_to: string | null;
          id: string;
          marketplace: string;
          notes: string | null;
          rules: Json;
          source_url: string | null;
          version: string;
        };
        Insert: {
          account_type?: string | null;
          channel: string;
          created_at?: string;
          effective_from: string;
          effective_to?: string | null;
          id?: string;
          marketplace: string;
          notes?: string | null;
          rules: Json;
          source_url?: string | null;
          version: string;
        };
        Update: {
          account_type?: string | null;
          channel?: string;
          created_at?: string;
          effective_from?: string;
          effective_to?: string | null;
          id?: string;
          marketplace?: string;
          notes?: string | null;
          rules?: Json;
          source_url?: string | null;
          version?: string;
        };
        Relationships: [];
      };
      incidents: {
        Row: {
          acknowledged_at: string | null;
          channel_account_id: string | null;
          channel_listing_id: string | null;
          created_at: string;
          details: Json;
          id: string;
          kind: string;
          resolved_at: string | null;
          severity: number;
          sku_id: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          acknowledged_at?: string | null;
          channel_account_id?: string | null;
          channel_listing_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          kind: string;
          resolved_at?: string | null;
          severity?: number;
          sku_id?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          acknowledged_at?: string | null;
          channel_account_id?: string | null;
          channel_listing_id?: string | null;
          created_at?: string;
          details?: Json;
          id?: string;
          kind?: string;
          resolved_at?: string | null;
          severity?: number;
          sku_id?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "incidents_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_channel_listing_id_fkey";
            columns: ["channel_listing_id"];
            isOneToOne: false;
            referencedRelation: "channel_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "incidents_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      ledger_events: {
        Row: {
          actor: string;
          id: string;
          idempotency_key: string;
          kind: string;
          metadata: Json;
          occurred_at: string;
          order_line_id: string | null;
          quantity_delta: number;
          recorded_at: string;
          seq: number;
          sku_id: string;
          source_channel_account_id: string | null;
          workspace_id: string;
        };
        Insert: {
          actor: string;
          id?: string;
          idempotency_key: string;
          kind: string;
          metadata?: Json;
          occurred_at?: string;
          order_line_id?: string | null;
          quantity_delta: number;
          recorded_at?: string;
          seq?: never;
          sku_id: string;
          source_channel_account_id?: string | null;
          workspace_id: string;
        };
        Update: {
          actor?: string;
          id?: string;
          idempotency_key?: string;
          kind?: string;
          metadata?: Json;
          occurred_at?: string;
          order_line_id?: string | null;
          quantity_delta?: number;
          recorded_at?: string;
          seq?: never;
          sku_id?: string;
          source_channel_account_id?: string | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "ledger_events_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_events_source_channel_account_id_fkey";
            columns: ["source_channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "ledger_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      order_buyer_details: {
        Row: {
          address: Json | null;
          created_at: string;
          email: string | null;
          name: string | null;
          order_id: string;
          phone: string | null;
          purge_after: string;
          workspace_id: string;
        };
        Insert: {
          address?: Json | null;
          created_at?: string;
          email?: string | null;
          name?: string | null;
          order_id: string;
          phone?: string | null;
          purge_after: string;
          workspace_id: string;
        };
        Update: {
          address?: Json | null;
          created_at?: string;
          email?: string | null;
          name?: string | null;
          order_id?: string;
          phone?: string | null;
          purge_after?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_buyer_details_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: true;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_buyer_details_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      order_lines: {
        Row: {
          channel_listing_id: string | null;
          created_at: string;
          external_line_id: string;
          external_listing_id: string | null;
          id: string;
          line_fees_minor: number | null;
          order_id: string;
          quantity: number;
          sku_id: string | null;
          status: string;
          title_snapshot: string | null;
          unit_price_minor: number;
          workspace_id: string;
        };
        Insert: {
          channel_listing_id?: string | null;
          created_at?: string;
          external_line_id: string;
          external_listing_id?: string | null;
          id?: string;
          line_fees_minor?: number | null;
          order_id: string;
          quantity: number;
          sku_id?: string | null;
          status?: string;
          title_snapshot?: string | null;
          unit_price_minor?: number;
          workspace_id: string;
        };
        Update: {
          channel_listing_id?: string | null;
          created_at?: string;
          external_line_id?: string;
          external_listing_id?: string | null;
          id?: string;
          line_fees_minor?: number | null;
          order_id?: string;
          quantity?: number;
          sku_id?: string | null;
          status?: string;
          title_snapshot?: string | null;
          unit_price_minor?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "order_lines_channel_listing_id_fkey";
            columns: ["channel_listing_id"];
            isOneToOne: false;
            referencedRelation: "channel_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_order_id_fkey";
            columns: ["order_id"];
            isOneToOne: false;
            referencedRelation: "orders";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: false;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "order_lines_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      orders: {
        Row: {
          buyer_display: string | null;
          channel_account_id: string;
          created_at: string;
          currency: string;
          external_order_id: string;
          fees_minor: number | null;
          id: string;
          placed_at: string;
          postage_charged_minor: number;
          raw_ref: string | null;
          ship_to_country: string | null;
          ship_to_postcode_area: string | null;
          status: string;
          subtotal_minor: number;
          total_minor: number;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          buyer_display?: string | null;
          channel_account_id: string;
          created_at?: string;
          currency?: string;
          external_order_id: string;
          fees_minor?: number | null;
          id?: string;
          placed_at: string;
          postage_charged_minor?: number;
          raw_ref?: string | null;
          ship_to_country?: string | null;
          ship_to_postcode_area?: string | null;
          status: string;
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          buyer_display?: string | null;
          channel_account_id?: string;
          created_at?: string;
          currency?: string;
          external_order_id?: string;
          fees_minor?: number | null;
          id?: string;
          placed_at?: string;
          postage_charged_minor?: number;
          raw_ref?: string | null;
          ship_to_country?: string | null;
          ship_to_postcode_area?: string | null;
          status?: string;
          subtotal_minor?: number;
          total_minor?: number;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "orders_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "orders_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      product_photos: {
        Row: {
          bytes: number | null;
          created_at: string;
          height: number | null;
          id: string;
          position: number;
          product_id: string;
          sha256: string | null;
          storage_path: string;
          width: number | null;
          workspace_id: string;
        };
        Insert: {
          bytes?: number | null;
          created_at?: string;
          height?: number | null;
          id?: string;
          position?: number;
          product_id: string;
          sha256?: string | null;
          storage_path: string;
          width?: number | null;
          workspace_id: string;
        };
        Update: {
          bytes?: number | null;
          created_at?: string;
          height?: number | null;
          id?: string;
          position?: number;
          product_id?: string;
          sha256?: string | null;
          storage_path?: string;
          width?: number | null;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "product_photos_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "product_photos_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      products: {
        Row: {
          attributes: Json;
          base_price_minor: number;
          brand: string | null;
          category_path: string | null;
          condition: string | null;
          cost_minor: number | null;
          created_at: string;
          currency: string;
          default_postage_minor: number | null;
          deleted_at: string | null;
          description: string;
          id: string;
          item_type: string;
          status: string;
          title: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          attributes?: Json;
          base_price_minor: number;
          brand?: string | null;
          category_path?: string | null;
          condition?: string | null;
          cost_minor?: number | null;
          created_at?: string;
          currency?: string;
          default_postage_minor?: number | null;
          deleted_at?: string | null;
          description?: string;
          id?: string;
          item_type: string;
          status?: string;
          title: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          attributes?: Json;
          base_price_minor?: number;
          brand?: string | null;
          category_path?: string | null;
          condition?: string | null;
          cost_minor?: number | null;
          created_at?: string;
          currency?: string;
          default_postage_minor?: number | null;
          deleted_at?: string | null;
          description?: string;
          id?: string;
          item_type?: string;
          status?: string;
          title?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "products_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      push_jobs: {
        Row: {
          attempts: number;
          channel_account_id: string;
          channel_listing_id: string;
          created_at: string;
          desired: Json;
          finished_at: string | null;
          id: string;
          kind: string;
          last_error: Json | null;
          ledger_seq: number;
          next_attempt_at: string;
          priority: number;
          started_at: string | null;
          status: string;
          workspace_id: string;
        };
        Insert: {
          attempts?: number;
          channel_account_id: string;
          channel_listing_id: string;
          created_at?: string;
          desired?: Json;
          finished_at?: string | null;
          id?: string;
          kind: string;
          last_error?: Json | null;
          ledger_seq?: number;
          next_attempt_at?: string;
          priority?: number;
          started_at?: string | null;
          status?: string;
          workspace_id: string;
        };
        Update: {
          attempts?: number;
          channel_account_id?: string;
          channel_listing_id?: string;
          created_at?: string;
          desired?: Json;
          finished_at?: string | null;
          id?: string;
          kind?: string;
          last_error?: Json | null;
          ledger_seq?: number;
          next_attempt_at?: string;
          priority?: number;
          started_at?: string | null;
          status?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "push_jobs_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_jobs_channel_listing_id_fkey";
            columns: ["channel_listing_id"];
            isOneToOne: false;
            referencedRelation: "channel_listings";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "push_jobs_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sale_costings: {
        Row: {
          computed_at: string;
          cost_minor: number | null;
          fee_schedule_id: string | null;
          fees_minor: number;
          gross_minor: number;
          inputs: Json;
          margin_bps: number | null;
          net_minor: number | null;
          order_line_id: string;
          postage_cost_minor: number;
          workspace_id: string;
        };
        Insert: {
          computed_at?: string;
          cost_minor?: number | null;
          fee_schedule_id?: string | null;
          fees_minor: number;
          gross_minor: number;
          inputs?: Json;
          margin_bps?: number | null;
          net_minor?: number | null;
          order_line_id: string;
          postage_cost_minor?: number;
          workspace_id: string;
        };
        Update: {
          computed_at?: string;
          cost_minor?: number | null;
          fee_schedule_id?: string | null;
          fees_minor?: number;
          gross_minor?: number;
          inputs?: Json;
          margin_bps?: number | null;
          net_minor?: number | null;
          order_line_id?: string;
          postage_cost_minor?: number;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sale_costings_fee_schedule_id_fkey";
            columns: ["fee_schedule_id"];
            isOneToOne: false;
            referencedRelation: "fee_schedules";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_costings_order_line_id_fkey";
            columns: ["order_line_id"];
            isOneToOne: true;
            referencedRelation: "order_lines";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sale_costings_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      sku_stock: {
        Row: {
          last_event_seq: number;
          on_hand: number;
          sku_id: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          last_event_seq?: number;
          on_hand?: number;
          sku_id: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          last_event_seq?: number;
          on_hand?: number;
          sku_id?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "sku_stock_sku_id_fkey";
            columns: ["sku_id"];
            isOneToOne: true;
            referencedRelation: "skus";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "sku_stock_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      skus: {
        Row: {
          barcode: string | null;
          cost_override_minor: number | null;
          created_at: string;
          deleted_at: string | null;
          id: string;
          option_values: Json;
          price_override_minor: number | null;
          product_id: string;
          sku: string;
          updated_at: string;
          workspace_id: string;
        };
        Insert: {
          barcode?: string | null;
          cost_override_minor?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          option_values?: Json;
          price_override_minor?: number | null;
          product_id: string;
          sku: string;
          updated_at?: string;
          workspace_id: string;
        };
        Update: {
          barcode?: string | null;
          cost_override_minor?: number | null;
          created_at?: string;
          deleted_at?: string | null;
          id?: string;
          option_values?: Json;
          price_override_minor?: number | null;
          product_id?: string;
          sku?: string;
          updated_at?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "skus_product_id_fkey";
            columns: ["product_id"];
            isOneToOne: false;
            referencedRelation: "products";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "skus_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      stripe_events: {
        Row: {
          id: string;
          payload: Json;
          processed_at: string | null;
          received_at: string;
          type: string;
        };
        Insert: {
          id: string;
          payload: Json;
          processed_at?: string | null;
          received_at?: string;
          type: string;
        };
        Update: {
          id?: string;
          payload?: Json;
          processed_at?: string | null;
          received_at?: string;
          type?: string;
        };
        Relationships: [];
      };
      system_notices: {
        Row: {
          channel: string | null;
          channel_account_id: string | null;
          ends_at: string | null;
          id: string;
          link: string | null;
          message: string;
          scope: string;
          severity: string;
          starts_at: string;
        };
        Insert: {
          channel?: string | null;
          channel_account_id?: string | null;
          ends_at?: string | null;
          id?: string;
          link?: string | null;
          message: string;
          scope: string;
          severity?: string;
          starts_at?: string;
        };
        Update: {
          channel?: string | null;
          channel_account_id?: string | null;
          ends_at?: string | null;
          id?: string;
          link?: string | null;
          message?: string;
          scope?: string;
          severity?: string;
          starts_at?: string;
        };
        Relationships: [
          {
            foreignKeyName: "system_notices_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
        ];
      };
      webhook_events: {
        Row: {
          body: string;
          channel: string;
          channel_account_id: string | null;
          error: Json | null;
          external_event_id: string;
          headers: Json;
          id: string;
          payload_hash: string;
          processed_at: string | null;
          received_at: string;
          source_ip: string | null;
          status: string;
          topic: string | null;
          workspace_id: string | null;
        };
        Insert: {
          body: string;
          channel: string;
          channel_account_id?: string | null;
          error?: Json | null;
          external_event_id: string;
          headers?: Json;
          id?: string;
          payload_hash: string;
          processed_at?: string | null;
          received_at?: string;
          source_ip?: string | null;
          status?: string;
          topic?: string | null;
          workspace_id?: string | null;
        };
        Update: {
          body?: string;
          channel?: string;
          channel_account_id?: string | null;
          error?: Json | null;
          external_event_id?: string;
          headers?: Json;
          id?: string;
          payload_hash?: string;
          processed_at?: string | null;
          received_at?: string;
          source_ip?: string | null;
          status?: string;
          topic?: string | null;
          workspace_id?: string | null;
        };
        Relationships: [
          {
            foreignKeyName: "webhook_events_channel_account_id_fkey";
            columns: ["channel_account_id"];
            isOneToOne: false;
            referencedRelation: "channel_accounts";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "webhook_events_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspace_members: {
        Row: {
          created_at: string;
          role: string;
          user_id: string;
          workspace_id: string;
        };
        Insert: {
          created_at?: string;
          role?: string;
          user_id: string;
          workspace_id: string;
        };
        Update: {
          created_at?: string;
          role?: string;
          user_id?: string;
          workspace_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "workspace_members_workspace_id_fkey";
            columns: ["workspace_id"];
            isOneToOne: false;
            referencedRelation: "workspaces";
            referencedColumns: ["id"];
          },
        ];
      };
      workspaces: {
        Row: {
          billing_status: string;
          created_at: string;
          currency: string;
          deleted_at: string | null;
          feature_flags: Json;
          founding_price_lock: boolean;
          id: string;
          name: string;
          settings: Json;
          slug: string;
          stripe_customer_id: string | null;
          stripe_subscription_id: string | null;
          trial_ends_at: string | null;
          updated_at: string;
          vat_registered: boolean;
        };
        Insert: {
          billing_status?: string;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          feature_flags?: Json;
          founding_price_lock?: boolean;
          id?: string;
          name: string;
          settings?: Json;
          slug: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          vat_registered?: boolean;
        };
        Update: {
          billing_status?: string;
          created_at?: string;
          currency?: string;
          deleted_at?: string | null;
          feature_flags?: Json;
          founding_price_lock?: boolean;
          id?: string;
          name?: string;
          settings?: Json;
          slug?: string;
          stripe_customer_id?: string | null;
          stripe_subscription_id?: string | null;
          trial_ends_at?: string | null;
          updated_at?: string;
          vat_registered?: boolean;
        };
        Relationships: [];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      apply_ledger_event: {
        Args: {
          p_actor: string;
          p_idempotency_key: string;
          p_kind: string;
          p_metadata?: Json;
          p_occurred_at?: string;
          p_order_line_id?: string;
          p_quantity_delta: number;
          p_sku_id: string;
          p_source_channel_account_id?: string;
          p_workspace_id: string;
        };
        Returns: Json;
      };
      claim_push_job: {
        Args: { p_job_id: string };
        Returns: {
          attempts: number;
          channel_account_id: string;
          channel_listing_id: string;
          created_at: string;
          desired: Json;
          finished_at: string | null;
          id: string;
          kind: string;
          last_error: Json | null;
          ledger_seq: number;
          next_attempt_at: string;
          priority: number;
          started_at: string | null;
          status: string;
          workspace_id: string;
        }[];
        SetofOptions: {
          from: "*";
          to: "push_jobs";
          isOneToOne: false;
          isSetofReturn: true;
        };
      };
      create_workspace: {
        Args: { p_name: string; p_slug: string };
        Returns: string;
      };
      retry_push_job: { Args: { p_job_id: string }; Returns: undefined };
    };
    Enums: {
      [_ in never]: never;
    };
    CompositeTypes: {
      [_ in never]: never;
    };
  };
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, "public">];

export type Tables<
  DefaultSchemaTableNameOrOptions extends
    | keyof (DefaultSchema["Tables"] & DefaultSchema["Views"])
    | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  DefaultSchemaTableNameOrOptions extends keyof DefaultSchema["Tables"] | { schema: keyof DatabaseWithoutInternals },
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"] | { schema: keyof DatabaseWithoutInternals },
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
> = DefaultSchemaEnumNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"][EnumName]
  : DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema["Enums"]
    ? DefaultSchema["Enums"][DefaultSchemaEnumNameOrOptions]
    : never;

export type CompositeTypes<
  PublicCompositeTypeNameOrOptions extends
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals;
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals;
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never;

export const Constants = {
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
