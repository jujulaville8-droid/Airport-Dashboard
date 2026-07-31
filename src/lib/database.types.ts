export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

type TableDefinition<
  Row,
  Insert,
  Update = Partial<Insert>,
  Relationships extends readonly unknown[] = [],
> = {
  Row: Row;
  Insert: Insert;
  Update: Update;
  Relationships: Relationships;
};

export type Database = {
  public: {
    Tables: {
      ai_analysis_results: TableDefinition<
        {
          action_items: string | null;
          analysis_date: string;
          analysis_type: string;
          claude_response: Json | null;
          confidence_level: string | null;
          created_at: string | null;
          id: number;
          input_context: Json | null;
          model_used: string | null;
          token_usage: Json | null;
        },
        {
          action_items?: string | null;
          analysis_date: string;
          analysis_type: string;
          claude_response?: Json | null;
          confidence_level?: string | null;
          created_at?: string | null;
          id?: number;
          input_context?: Json | null;
          model_used?: string | null;
          token_usage?: Json | null;
        }
      >;
      flight_data: TableDefinition<
        {
          actual_passengers: number | null;
          actual_passengers_source: string | null;
          actual_passengers_updated_at: string | null;
          aircraft_type: string | null;
          airline_code: string | null;
          estimated_passengers: number | null;
          flight_date: string;
          flight_num: string;
          flight_type: string;
          gate: string | null;
          id: number;
          origin_destination: string | null;
          parsed_at: string | null;
          schedule_month: string | null;
          schedule_week_start: string | null;
          scheduled_time: string;
          status: string | null;
          terminal: string | null;
        },
        {
          actual_passengers?: number | null;
          actual_passengers_source?: string | null;
          actual_passengers_updated_at?: string | null;
          aircraft_type?: string | null;
          airline_code?: string | null;
          estimated_passengers?: number | null;
          flight_date: string;
          flight_num: string;
          flight_type: string;
          gate?: string | null;
          id?: number;
          origin_destination?: string | null;
          parsed_at?: string | null;
          schedule_month?: string | null;
          schedule_week_start?: string | null;
          scheduled_time: string;
          status?: string | null;
          terminal?: string | null;
        }
      >;
      flight_schedule_files: TableDefinition<
        {
          file_name: string;
          file_size: number;
          schedule_month: string;
          storage_path: string;
          uploaded_at: string | null;
        },
        {
          file_name: string;
          file_size: number;
          schedule_month: string;
          storage_path: string;
          uploaded_at?: string | null;
        }
      >;
      import_logs: TableDefinition<
        {
          attempted_at: string | null;
          created_at: string | null;
          error_messages: Json | null;
          failed_records: number | null;
          file_name: string | null;
          id: number;
          import_date: string | null;
          message: string | null;
          reconciliation_status: string | null;
          source: string | null;
          source_type: string;
          status: string | null;
          successful_records: number | null;
          total_records: number | null;
        },
        {
          attempted_at?: string | null;
          created_at?: string | null;
          error_messages?: Json | null;
          failed_records?: number | null;
          file_name?: string | null;
          id?: number;
          import_date?: string | null;
          message?: string | null;
          reconciliation_status?: string | null;
          source?: string | null;
          source_type: string;
          status?: string | null;
          successful_records?: number | null;
          total_records?: number | null;
        }
      >;
      inventory_snapshots: TableDefinition<
        {
          created_at: string | null;
          id: number;
          item_no: string;
          qty_on_hand: number;
          snapshot_date: string;
          source_batch_id: string | null;
          total_value: number | null;
          unit_cost: number | null;
        },
        {
          created_at?: string | null;
          id?: number;
          item_no: string;
          qty_on_hand: number;
          snapshot_date: string;
          source_batch_id?: string | null;
          total_value?: number | null;
          unit_cost?: number | null;
        },
        Partial<{
          created_at: string | null;
          id: number;
          item_no: string;
          qty_on_hand: number;
          snapshot_date: string;
          source_batch_id: string | null;
          total_value: number | null;
          unit_cost: number | null;
        }>,
        [{
          foreignKeyName: 'inventory_snapshots_item_no_fkey';
          columns: ['item_no'];
          isOneToOne: false;
          referencedRelation: 'item_master';
          referencedColumns: ['item_no'];
        }]
      >;
      item_master: TableDefinition<
        {
          categ_cod: string | null;
          descr: string | null;
          first_seen_at: string | null;
          is_active: boolean | null;
          item_no: string;
          last_seen_at: string | null;
          subcat_cod: string | null;
          unit_cost: number | null;
          unit_price: number | null;
        },
        {
          categ_cod?: string | null;
          descr?: string | null;
          first_seen_at?: string | null;
          is_active?: boolean | null;
          item_no: string;
          last_seen_at?: string | null;
          subcat_cod?: string | null;
          unit_cost?: number | null;
          unit_price?: number | null;
        }
      >;
      reorder_rules: TableDefinition<
        {
          item_no: string;
          lead_time_days: number | null;
          max_stock: number | null;
          min_stock: number | null;
          notes: string | null;
          reorder_point: number | null;
          updated_at: string | null;
        },
        {
          item_no: string;
          lead_time_days?: number | null;
          max_stock?: number | null;
          min_stock?: number | null;
          notes?: string | null;
          reorder_point?: number | null;
          updated_at?: string | null;
        },
        Partial<{
          item_no: string;
          lead_time_days: number | null;
          max_stock: number | null;
          min_stock: number | null;
          notes: string | null;
          reorder_point: number | null;
          updated_at: string | null;
        }>,
        [{
          foreignKeyName: 'reorder_rules_item_no_fkey';
          columns: ['item_no'];
          isOneToOne: true;
          referencedRelation: 'item_master';
          referencedColumns: ['item_no'];
        }]
      >;
      sales_line_items: TableDefinition<
        {
          categ_cod: string | null;
          descr: string | null;
          disc_amt: number | null;
          ext_prc: number | null;
          id: number;
          item_no: string | null;
          prc: number | null;
          qty_sold: number | null;
          subcat_cod: string | null;
          tkt_no: string;
        },
        {
          categ_cod?: string | null;
          descr?: string | null;
          disc_amt?: number | null;
          ext_prc?: number | null;
          id?: number;
          item_no?: string | null;
          prc?: number | null;
          qty_sold?: number | null;
          subcat_cod?: string | null;
          tkt_no: string;
        },
        Partial<{
          categ_cod: string | null;
          descr: string | null;
          disc_amt: number | null;
          ext_prc: number | null;
          id: number;
          item_no: string | null;
          prc: number | null;
          qty_sold: number | null;
          subcat_cod: string | null;
          tkt_no: string;
        }>,
        [{
          foreignKeyName: 'sales_line_items_tkt_no_fkey';
          columns: ['tkt_no'];
          isOneToOne: false;
          referencedRelation: 'sales_transactions';
          referencedColumns: ['tkt_no'];
        }]
      >;
      sales_transactions: TableDefinition<
        {
          cust_no: string | null;
          disc_amt: number | null;
          hourly_breakdown: Json | null;
          id: number;
          import_batch_id: string | null;
          imported_at: string | null;
          pmt_cod: string | null;
          sta_id: string | null;
          str_id: string | null;
          tax_amt: number | null;
          ticket_count: number | null;
          tkt_dt: string;
          tkt_no: string;
          tot_amt: number | null;
          upload_type: string | null;
          usr_id: string | null;
        },
        {
          cust_no?: string | null;
          disc_amt?: number | null;
          hourly_breakdown?: Json | null;
          id?: number;
          import_batch_id?: string | null;
          imported_at?: string | null;
          pmt_cod?: string | null;
          sta_id?: string | null;
          str_id?: string | null;
          tax_amt?: number | null;
          ticket_count?: number | null;
          tkt_dt: string;
          tkt_no: string;
          tot_amt?: number | null;
          upload_type?: string | null;
          usr_id?: string | null;
        }
      >;
      staff_members: TableDefinition<
        {
          available_end: string;
          available_start: string;
          created_at: string;
          days_off_per_week: number | null;
          full_name: string;
          id: string;
          is_active: boolean;
          max_hours_per_day: number;
          min_hours_per_day: number;
          name: string;
          role: string;
          updated_at: string;
          weekly_hour_target: number | null;
        },
        {
          available_end?: string;
          available_start?: string;
          created_at?: string;
          days_off_per_week?: number | null;
          full_name: string;
          id?: string;
          is_active?: boolean;
          max_hours_per_day?: number;
          min_hours_per_day?: number;
          name: string;
          role: string;
          updated_at?: string;
          weekly_hour_target?: number | null;
        }
      >;
      staff_schedules: TableDefinition<
        {
          ai_confidence: number | null;
          created_at: string | null;
          generated_by: string | null;
          id: number;
          schedule_date: string;
          shift_end: string;
          shift_hours: number | null;
          shift_start: string;
          staff_name: string;
          status: string | null;
          updated_at: string | null;
        },
        {
          ai_confidence?: number | null;
          created_at?: string | null;
          generated_by?: string | null;
          id?: number;
          schedule_date: string;
          shift_end: string;
          shift_hours?: number | null;
          shift_start: string;
          staff_name: string;
          status?: string | null;
          updated_at?: string | null;
        }
      >;
    };
    Views: Record<never, never>;
    Functions: Record<never, never>;
    Enums: Record<never, never>;
    CompositeTypes: Record<never, never>;
  };
};

export type Tables<
  TableName extends keyof Database['public']['Tables'],
> = Database['public']['Tables'][TableName]['Row'];

export type TablesInsert<
  TableName extends keyof Database['public']['Tables'],
> = Database['public']['Tables'][TableName]['Insert'];

export type TablesUpdate<
  TableName extends keyof Database['public']['Tables'],
> = Database['public']['Tables'][TableName]['Update'];
