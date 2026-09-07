export type Json =
  | string
  | number
  | boolean
  | null
  | { [key: string]: Json | undefined }
  | Json[];

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
      feedback_reports: {
        Row: {
          app_version: string;
          blocked_user: boolean;
          category: string;
          client_context: Json;
          created_at: string;
          digest_batch_id: string | null;
          digest_email_id: string | null;
          digest_sent_at: string | null;
          id: string;
          may_contact: boolean;
          message: string;
          page_path: string;
          program_id: string | null;
          resolved_at: string | null;
          status: string;
          user_id: string;
        };
        Insert: {
          app_version: string;
          blocked_user?: boolean;
          category: string;
          client_context?: Json;
          created_at?: string;
          digest_batch_id?: string | null;
          digest_email_id?: string | null;
          digest_sent_at?: string | null;
          id?: string;
          may_contact?: boolean;
          message: string;
          page_path: string;
          program_id?: string | null;
          resolved_at?: string | null;
          status?: string;
          user_id: string;
        };
        Update: {
          app_version?: string;
          blocked_user?: boolean;
          category?: string;
          client_context?: Json;
          created_at?: string;
          digest_batch_id?: string | null;
          digest_email_id?: string | null;
          digest_sent_at?: string | null;
          id?: string;
          may_contact?: boolean;
          message?: string;
          page_path?: string;
          program_id?: string | null;
          resolved_at?: string | null;
          status?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "feedback_reports_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      fitness_connections: {
        Row: {
          connected_at: string;
          consent_version: string;
          created_at: string;
          device_key_hash: string | null;
          disconnected_at: string | null;
          generation: number;
          id: string;
          last_error_code: string | null;
          last_synced_at: string | null;
          metadata: Json;
          provider: string;
          scopes: string[];
          status: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connected_at?: string;
          consent_version: string;
          created_at?: string;
          device_key_hash?: string | null;
          disconnected_at?: string | null;
          generation?: number;
          id?: string;
          last_error_code?: string | null;
          last_synced_at?: string | null;
          metadata?: Json;
          provider: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connected_at?: string;
          consent_version?: string;
          created_at?: string;
          device_key_hash?: string | null;
          disconnected_at?: string | null;
          generation?: number;
          id?: string;
          last_error_code?: string | null;
          last_synced_at?: string | null;
          metadata?: Json;
          provider?: string;
          scopes?: string[];
          status?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [];
      };
      fitness_consent_events: {
        Row: {
          connection_id: string;
          consent_version: string;
          details: Json;
          event_key: string;
          event_type: string;
          id: string;
          occurred_at: string;
          scopes: string[];
          source: string;
          user_id: string;
        };
        Insert: {
          connection_id: string;
          consent_version: string;
          details?: Json;
          event_key: string;
          event_type: string;
          id?: string;
          occurred_at?: string;
          scopes?: string[];
          source?: string;
          user_id: string;
        };
        Update: {
          connection_id?: string;
          consent_version?: string;
          details?: Json;
          event_key?: string;
          event_type?: string;
          id?: string;
          occurred_at?: string;
          scopes?: string[];
          source?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_consent_events_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      fitness_daily_metrics: {
        Row: {
          active_calories: number | null;
          active_minutes: number | null;
          connection_id: string;
          distance_meters: number | null;
          extensions: Json;
          hrv_rmssd_ms: number | null;
          id: string;
          ingested_at: string;
          metric_date: string;
          recovery_score: number | null;
          respiratory_rate: number | null;
          resting_heart_rate: number | null;
          sleep_end_at: string | null;
          sleep_minutes: number | null;
          sleep_score: number | null;
          sleep_stages: Json;
          sleep_start_at: string | null;
          source_updated_at: string | null;
          spo2_percent: number | null;
          steps: number | null;
          strain_score: number | null;
          timezone: string | null;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          active_calories?: number | null;
          active_minutes?: number | null;
          connection_id: string;
          distance_meters?: number | null;
          extensions?: Json;
          hrv_rmssd_ms?: number | null;
          id?: string;
          ingested_at?: string;
          metric_date: string;
          recovery_score?: number | null;
          respiratory_rate?: number | null;
          resting_heart_rate?: number | null;
          sleep_end_at?: string | null;
          sleep_minutes?: number | null;
          sleep_score?: number | null;
          sleep_stages?: Json;
          sleep_start_at?: string | null;
          source_updated_at?: string | null;
          spo2_percent?: number | null;
          steps?: number | null;
          strain_score?: number | null;
          timezone?: string | null;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          active_calories?: number | null;
          active_minutes?: number | null;
          connection_id?: string;
          distance_meters?: number | null;
          extensions?: Json;
          hrv_rmssd_ms?: number | null;
          id?: string;
          ingested_at?: string;
          metric_date?: string;
          recovery_score?: number | null;
          respiratory_rate?: number | null;
          resting_heart_rate?: number | null;
          sleep_end_at?: string | null;
          sleep_minutes?: number | null;
          sleep_score?: number | null;
          sleep_stages?: Json;
          sleep_start_at?: string | null;
          source_updated_at?: string | null;
          spo2_percent?: number | null;
          steps?: number | null;
          strain_score?: number | null;
          timezone?: string | null;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_daily_metrics_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      fitness_hr_5m: {
        Row: {
          average_bpm: number;
          bucket_start: string;
          connection_id: string;
          maximum_bpm: number;
          minimum_bpm: number;
          sample_count: number | null;
          source: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          average_bpm: number;
          bucket_start: string;
          connection_id: string;
          maximum_bpm: number;
          minimum_bpm: number;
          sample_count?: number | null;
          source?: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          average_bpm?: number;
          bucket_start?: string;
          connection_id?: string;
          maximum_bpm?: number;
          minimum_bpm?: number;
          sample_count?: number | null;
          source?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_hr_5m_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      fitness_hr_samples: {
        Row: {
          bpm: number;
          connection_id: string;
          expires_at: string;
          ingested_at: string;
          quality: number | null;
          sampled_at: string;
          source_record_id: string | null;
          source_session_key: string | null;
          user_id: string;
        };
        Insert: {
          bpm: number;
          connection_id: string;
          expires_at?: string;
          ingested_at?: string;
          quality?: number | null;
          sampled_at: string;
          source_record_id?: string | null;
          source_session_key?: string | null;
          user_id: string;
        };
        Update: {
          bpm?: number;
          connection_id?: string;
          expires_at?: string;
          ingested_at?: string;
          quality?: number | null;
          sampled_at?: string;
          source_record_id?: string | null;
          source_session_key?: string | null;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_hr_samples_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      fitness_summaries: {
        Row: {
          connection_id: string;
          created_at: string;
          id: string;
          metrics: Json;
          period_end: string;
          period_start: string;
          source_key: string;
          summary_type: string;
          updated_at: string;
          user_id: string;
        };
        Insert: {
          connection_id: string;
          created_at?: string;
          id?: string;
          metrics?: Json;
          period_end: string;
          period_start: string;
          source_key: string;
          summary_type: string;
          updated_at?: string;
          user_id: string;
        };
        Update: {
          connection_id?: string;
          created_at?: string;
          id?: string;
          metrics?: Json;
          period_end?: string;
          period_start?: string;
          source_key?: string;
          summary_type?: string;
          updated_at?: string;
          user_id?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_summaries_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      fitness_workout_sessions: {
        Row: {
          active_calories: number | null;
          average_heart_rate: number | null;
          connection_id: string;
          created_at: string;
          distance_meters: number | null;
          duration_seconds: number | null;
          ended_at: string | null;
          id: string;
          maximum_heart_rate: number | null;
          metadata: Json;
          source_session_key: string;
          source_updated_at: string | null;
          started_at: string;
          strain_score: number | null;
          summary: Json;
          updated_at: string;
          user_id: string;
          workout_log_id: string | null;
          workout_type: string;
        };
        Insert: {
          active_calories?: number | null;
          average_heart_rate?: number | null;
          connection_id: string;
          created_at?: string;
          distance_meters?: number | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          maximum_heart_rate?: number | null;
          metadata?: Json;
          source_session_key: string;
          source_updated_at?: string | null;
          started_at: string;
          strain_score?: number | null;
          summary?: Json;
          updated_at?: string;
          user_id: string;
          workout_log_id?: string | null;
          workout_type: string;
        };
        Update: {
          active_calories?: number | null;
          average_heart_rate?: number | null;
          connection_id?: string;
          created_at?: string;
          distance_meters?: number | null;
          duration_seconds?: number | null;
          ended_at?: string | null;
          id?: string;
          maximum_heart_rate?: number | null;
          metadata?: Json;
          source_session_key?: string;
          source_updated_at?: string | null;
          started_at?: string;
          strain_score?: number | null;
          summary?: Json;
          updated_at?: string;
          user_id?: string;
          workout_log_id?: string | null;
          workout_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_workout_sessions_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
          {
            foreignKeyName: "fitness_workout_sessions_workout_log_id_fkey";
            columns: ["workout_log_id"];
            isOneToOne: false;
            referencedRelation: "workout_logs";
            referencedColumns: ["id"];
          },
        ];
      };
      fitness_workout_summaries: {
        Row: {
          active_calories: number | null;
          average_heart_rate: number | null;
          connection_id: string;
          created_at: string;
          distance_meters: number | null;
          ended_at: string;
          extensions: Json;
          heart_rate_zones: Json;
          id: string;
          maximum_heart_rate: number | null;
          source_updated_at: string | null;
          source_workout_id: string;
          started_at: string;
          strain_score: number | null;
          updated_at: string;
          user_id: string;
          workout_type: string;
        };
        Insert: {
          active_calories?: number | null;
          average_heart_rate?: number | null;
          connection_id: string;
          created_at?: string;
          distance_meters?: number | null;
          ended_at: string;
          extensions?: Json;
          heart_rate_zones?: Json;
          id?: string;
          maximum_heart_rate?: number | null;
          source_updated_at?: string | null;
          source_workout_id: string;
          started_at: string;
          strain_score?: number | null;
          updated_at?: string;
          user_id: string;
          workout_type: string;
        };
        Update: {
          active_calories?: number | null;
          average_heart_rate?: number | null;
          connection_id?: string;
          created_at?: string;
          distance_meters?: number | null;
          ended_at?: string;
          extensions?: Json;
          heart_rate_zones?: Json;
          id?: string;
          maximum_heart_rate?: number | null;
          source_updated_at?: string | null;
          source_workout_id?: string;
          started_at?: string;
          strain_score?: number | null;
          updated_at?: string;
          user_id?: string;
          workout_type?: string;
        };
        Relationships: [
          {
            foreignKeyName: "fitness_workout_summaries_connection_owner_fk";
            columns: ["connection_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "fitness_connections";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      profiles: {
        Row: {
          created_at: string;
          display_name: string;
          id: string;
        };
        Insert: {
          created_at?: string;
          display_name?: string;
          id: string;
        };
        Update: {
          created_at?: string;
          display_name?: string;
          id?: string;
        };
        Relationships: [];
      };
      program_versions: {
        Row: {
          created_at: string;
          engine_version: string;
          id: string;
          input_fingerprint: string;
          payload: Json | null;
          payload_hash: string;
          policy_version: string;
          program_id: string;
          questionnaire_response_id: string;
          reverse_patch: Json | null;
          storage_format: string;
          user_id: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          engine_version: string;
          id?: string;
          input_fingerprint: string;
          payload?: Json | null;
          payload_hash: string;
          policy_version: string;
          program_id: string;
          questionnaire_response_id: string;
          reverse_patch?: Json | null;
          storage_format?: string;
          user_id: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          engine_version?: string;
          id?: string;
          input_fingerprint?: string;
          payload?: Json | null;
          payload_hash?: string;
          policy_version?: string;
          program_id?: string;
          questionnaire_response_id?: string;
          reverse_patch?: Json | null;
          storage_format?: string;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "program_versions_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
          {
            foreignKeyName: "program_versions_questionnaire_response_id_fkey";
            columns: ["questionnaire_response_id"];
            isOneToOne: false;
            referencedRelation: "questionnaire_responses";
            referencedColumns: ["id"];
          },
        ];
      };
      programs: {
        Row: {
          created_at: string;
          id: string;
          name: string;
          payload: Json;
          user_id: string;
        };
        Insert: {
          created_at?: string;
          id?: string;
          name?: string;
          payload?: Json;
          user_id: string;
        };
        Update: {
          created_at?: string;
          id?: string;
          name?: string;
          payload?: Json;
          user_id?: string;
        };
        Relationships: [];
      };
      questionnaire_responses: {
        Row: {
          created_at: string;
          id: string;
          program_id: string;
          questionnaire_version: number;
          response: Json;
          user_id: string;
          version_number: number;
        };
        Insert: {
          created_at?: string;
          id?: string;
          program_id: string;
          questionnaire_version: number;
          response: Json;
          user_id: string;
          version_number: number;
        };
        Update: {
          created_at?: string;
          id?: string;
          program_id?: string;
          questionnaire_version?: number;
          response?: Json;
          user_id?: string;
          version_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "questionnaire_responses_program_id_fkey";
            columns: ["program_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id"];
          },
        ];
      };
      weekly_reviews: {
        Row: {
          confidence: string;
          created_at: string;
          decision: string;
          id: string;
          metrics: Json;
          program_id: string;
          result: Json;
          result_program_version: number;
          source_program_version: number;
          state: string;
          user_id: string;
          week_number: number;
        };
        Insert: {
          confidence: string;
          created_at?: string;
          decision: string;
          id?: string;
          metrics: Json;
          program_id: string;
          result: Json;
          result_program_version: number;
          source_program_version: number;
          state: string;
          user_id: string;
          week_number: number;
        };
        Update: {
          confidence?: string;
          created_at?: string;
          decision?: string;
          id?: string;
          metrics?: Json;
          program_id?: string;
          result?: Json;
          result_program_version?: number;
          source_program_version?: number;
          state?: string;
          user_id?: string;
          week_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "weekly_reviews_owned_program_fk";
            columns: ["program_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
      workout_logs: {
        Row: {
          cardio_log: Json;
          completed_at: string | null;
          created_at: string;
          duration_minutes: number | null;
          exercise_logs: Json;
          id: string;
          miss_reason: string | null;
          movement_log: Json;
          program_id: string;
          program_version: number;
          session_id: string;
          session_sequence: number;
          started_at: string;
          status: string;
          updated_at: string;
          user_id: string;
          week_number: number;
        };
        Insert: {
          cardio_log?: Json;
          completed_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          exercise_logs?: Json;
          id?: string;
          miss_reason?: string | null;
          movement_log?: Json;
          program_id: string;
          program_version: number;
          session_id: string;
          session_sequence: number;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id: string;
          week_number: number;
        };
        Update: {
          cardio_log?: Json;
          completed_at?: string | null;
          created_at?: string;
          duration_minutes?: number | null;
          exercise_logs?: Json;
          id?: string;
          miss_reason?: string | null;
          movement_log?: Json;
          program_id?: string;
          program_version?: number;
          session_id?: string;
          session_sequence?: number;
          started_at?: string;
          status?: string;
          updated_at?: string;
          user_id?: string;
          week_number?: number;
        };
        Relationships: [
          {
            foreignKeyName: "workout_logs_owned_program_fk";
            columns: ["program_id", "user_id"];
            isOneToOne: false;
            referencedRelation: "programs";
            referencedColumns: ["id", "user_id"];
          },
        ];
      };
    };
    Views: {
      [_ in never]: never;
    };
    Functions: {
      begin_feedback_digest_delivery: {
        Args: { p_batch_id: string };
        Returns: boolean;
      };
      claim_feedback_digest: {
        Args: { p_max_reports?: number; p_max_source_bytes?: number };
        Returns: Json;
      };
      complete_feedback_digest: {
        Args: { p_batch_id: string; p_provider_email_id: string };
        Returns: number;
      };
      create_program_with_initial_version: {
        Args: {
          p_engine_version: string;
          p_input_fingerprint: string;
          p_name: string;
          p_payload: Json;
          p_policy_version: string;
          p_questionnaire: Json;
          p_questionnaire_version: number;
        };
        Returns: string;
      };
      create_program_with_initial_version_v4: {
        Args: {
          p_engine_version: string;
          p_input_fingerprint: string;
          p_name: string;
          p_payload: Json;
          p_policy_version: string;
          p_questionnaire: Json;
          p_questionnaire_version: number;
        };
        Returns: string;
      };
      dashboard_program_context: {
        Args: { p_program_id: string };
        Returns: Json;
      };
      dashboard_program_context_v2: {
        Args: { p_program_id: string };
        Returns: Json;
      };
      delete_expired_feedback: {
        Args: { p_retention_days: number };
        Returns: number;
      };
      delete_my_account: { Args: never; Returns: boolean };
      export_my_feedback: { Args: never; Returns: Json };
      fail_feedback_digest: {
        Args: { p_batch_id: string; p_error: string };
        Returns: boolean;
      };
      fitness_claim_connection_sync: {
        Args: {
          p_connection_id: string;
          p_lease_seconds?: number;
          p_min_interval_seconds?: number;
          p_purpose?: string;
          p_user_id: string;
        };
        Returns: Json;
      };
      fitness_claim_sync_lease: {
        Args: {
          p_lease_seconds?: number;
          p_limit?: number;
          p_provider?: string;
        };
        Returns: Json[];
      };
      fitness_complete_sync_lease: {
        Args: {
          p_connection_id: string;
          p_cursor?: string;
          p_lease_token: string;
          p_next_sync_at?: string;
        };
        Returns: boolean;
      };
      fitness_disconnect_provider: {
        Args: {
          p_connection_id: string;
          p_delete_health_data?: boolean;
          p_user_id: string;
        };
        Returns: boolean;
      };
      fitness_delete_mobile_source_records: {
        Args: {
          p_connection_id: string;
          p_deletions: Json;
          p_expected_generation?: number;
          p_user_id: string;
        };
        Returns: Json;
      };
      fitness_end_workout_session: {
        Args: {
          p_connection_id: string;
          p_ended_at: string;
          p_source_session_key: string;
          p_summary?: Json;
          p_user_id: string;
        };
        Returns: string;
      };
      fitness_fail_sync_lease: {
        Args: {
          p_connection_id: string;
          p_error_code: string;
          p_lease_token: string;
          p_next_sync_at?: string;
        };
        Returns: boolean;
      };
      fitness_get_workout_detail: {
        Args: { p_workout_session_id: string };
        Returns: Json;
      };
      fitness_ingest_hr_samples: {
        Args: {
          p_connection_id: string;
          p_expected_generation?: number;
          p_samples: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      fitness_load_connection_tokens: {
        Args: { p_connection_id: string; p_user_id: string };
        Returns: Json;
      };
      fitness_register_device_connection: {
        Args: {
          p_consent_version?: string;
          p_device_key: string;
          p_metadata?: Json;
          p_provider: string;
          p_scopes?: string[];
          p_user_id: string;
        };
        Returns: string;
      };
      fitness_refresh_connection_tokens: {
        Args: {
          p_access_token_ciphertext: string;
          p_access_token_expires_at?: string;
          p_connection_id: string;
          p_encryption_key_version?: string;
          p_expected_generation: number;
          p_provider_account_key: string;
          p_refresh_token_ciphertext?: string;
          p_scopes?: string[];
          p_user_id: string;
        };
        Returns: boolean;
      };
      fitness_reset_workout_session: {
        Args: {
          p_connection_id: string;
          p_source_session_key: string;
          p_user_id: string;
        };
        Returns: boolean;
      };
      fitness_run_retention: {
        Args: {
          p_audit_days?: number;
          p_batch_limit?: number;
          p_raw_days?: number;
        };
        Returns: Json;
      };
      fitness_start_workout_session: {
        Args: {
          p_connection_id: string;
          p_metadata?: Json;
          p_source_session_key: string;
          p_started_at: string;
          p_user_id: string;
          p_workout_type: string;
        };
        Returns: string;
      };
      fitness_store_connection_tokens: {
        Args: {
          p_access_token_ciphertext: string;
          p_access_token_expires_at?: string;
          p_consent_version?: string;
          p_encryption_key_version?: string;
          p_metadata?: Json;
          p_provider: string;
          p_provider_account_key: string;
          p_refresh_token_ciphertext?: string;
          p_scopes?: string[];
          p_user_id: string;
        };
        Returns: string;
      };
      fitness_upsert_daily_metrics: {
        Args: {
          p_connection_id: string;
          p_expected_generation?: number;
          p_metrics: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      fitness_upsert_hr_buckets: {
        Args: {
          p_buckets: Json;
          p_connection_id: string;
          p_expected_generation?: number;
          p_user_id: string;
        };
        Returns: Json;
      };
      fitness_upsert_workout_summaries: {
        Args: {
          p_connection_id: string;
          p_expected_generation?: number;
          p_summaries: Json;
          p_user_id: string;
        };
        Returns: Json;
      };
      lunar_completion_is_unlocked: { Args: never; Returns: boolean };
      questionnaire_engine_status: { Args: never; Returns: Json };
      record_program_substitution: {
        Args: {
          p_new_payload: Json;
          p_program_id: string;
          p_source_program_version: number;
        };
        Returns: Json;
      };
      record_weekly_review: {
        Args: {
          p_confidence: string;
          p_decision: string;
          p_metrics: Json;
          p_new_payload?: Json;
          p_program_id: string;
          p_result: Json;
          p_source_program_version: number;
          p_state: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      record_weekly_review_v4: {
        Args: {
          p_confidence: string;
          p_decision: string;
          p_metrics: Json;
          p_new_payload?: Json;
          p_program_id: string;
          p_result: Json;
          p_reverse_patch?: Json;
          p_source_program_version: number;
          p_state: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      replace_program_from_questionnaire: {
        Args: {
          p_engine_version: string;
          p_input_fingerprint: string;
          p_name: string;
          p_payload: Json;
          p_policy_version: string;
          p_program_id: string;
          p_questionnaire: Json;
          p_questionnaire_version: number;
        };
        Returns: string;
      };
      replace_program_from_questionnaire_v4: {
        Args: {
          p_engine_version: string;
          p_input_fingerprint: string;
          p_name: string;
          p_payload: Json;
          p_policy_version: string;
          p_program_id: string;
          p_questionnaire: Json;
          p_questionnaire_version: number;
        };
        Returns: string;
      };
      save_workout_log: {
        Args: {
          p_cardio_log: Json;
          p_duration_minutes?: number;
          p_exercise_logs: Json;
          p_miss_reason?: string;
          p_movement_log: Json;
          p_new_program_payload?: Json;
          p_program_id: string;
          p_program_version: number;
          p_session_id: string;
          p_session_sequence: number;
          p_status: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      save_workout_log_v4: {
        Args: {
          p_cardio_log: Json;
          p_duration_minutes?: number;
          p_exercise_logs: Json;
          p_miss_reason?: string;
          p_movement_log: Json;
          p_new_program_payload?: Json;
          p_program_id: string;
          p_program_version: number;
          p_reverse_patch?: Json;
          p_session_id: string;
          p_session_sequence: number;
          p_status: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      save_workout_log_v5: {
        Args: {
          p_cardio_log: Json;
          p_duration_minutes?: number;
          p_exercise_logs: Json;
          p_expected_revision?: string;
          p_miss_reason?: string;
          p_movement_log: Json;
          p_new_program_payload?: Json;
          p_program_id: string;
          p_program_version: number;
          p_reverse_patch?: Json;
          p_session_id: string;
          p_session_sequence: number;
          p_status: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      save_workout_log_v6: {
        Args: {
          p_cardio_log: Json;
          p_duration_minutes?: number;
          p_exercise_logs: Json;
          p_expected_revision?: string;
          p_miss_reason?: string;
          p_movement_log: Json;
          p_new_program_payload?: Json;
          p_program_id: string;
          p_program_version: number;
          p_reverse_patch?: Json;
          p_session_id: string;
          p_session_sequence: number;
          p_status: string;
          p_week_number: number;
        };
        Returns: Json;
      };
      submit_feedback: {
        Args: {
          p_app_version?: string;
          p_blocked_user: boolean;
          p_category: string;
          p_client_context?: Json;
          p_may_contact: boolean;
          p_message: string;
          p_page_path: string;
          p_program_id?: string;
        };
        Returns: string;
      };
      weekly_adaptation_status: { Args: never; Returns: Json };
      workout_logging_status: { Args: never; Returns: Json };
      workout_session_context: {
        Args: { p_program_id: string; p_session_id: string };
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
};

type DatabaseWithoutInternals = Omit<Database, "__InternalSupabase">;

type DefaultSchema = DatabaseWithoutInternals[Extract<
  keyof Database,
  "public"
>];

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
  : DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema["Tables"] &
        DefaultSchema["Views"])
    ? (DefaultSchema["Tables"] &
        DefaultSchema["Views"])[DefaultSchemaTableNameOrOptions] extends {
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
    | keyof DefaultSchema["CompositeTypes"]
    | { schema: keyof DatabaseWithoutInternals },
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
  graphql_public: {
    Enums: {},
  },
  public: {
    Enums: {},
  },
} as const;
