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
    PostgrestVersion: "14.5"
  }
  public: {
    Tables: {
      audio_samples: {
        Row: {
          bytes: number | null
          clipped: boolean | null
          created_at: string
          duration_sec: number | null
          format: string
          id: string
          job_id: string | null
          params: Json
          peak: number | null
          prompt_id: string
          rms: number | null
          sample_rate: number | null
          silence_ratio: number | null
          storage_path: string
          voice_id: string | null
        }
        Insert: {
          bytes?: number | null
          clipped?: boolean | null
          created_at?: string
          duration_sec?: number | null
          format?: string
          id?: string
          job_id?: string | null
          params?: Json
          peak?: number | null
          prompt_id: string
          rms?: number | null
          sample_rate?: number | null
          silence_ratio?: number | null
          storage_path: string
          voice_id?: string | null
        }
        Update: {
          bytes?: number | null
          clipped?: boolean | null
          created_at?: string
          duration_sec?: number | null
          format?: string
          id?: string
          job_id?: string | null
          params?: Json
          peak?: number | null
          prompt_id?: string
          rms?: number | null
          sample_rate?: number | null
          silence_ratio?: number | null
          storage_path?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "audio_samples_job_id_fkey"
            columns: ["job_id"]
            isOneToOne: false
            referencedRelation: "synthesis_jobs"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_samples_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "audio_samples_voice_id_fkey"
            columns: ["voice_id"]
            isOneToOne: false
            referencedRelation: "voices"
            referencedColumns: ["id"]
          },
        ]
      }
      audit_log: {
        Row: {
          action: string
          created_at: string
          detail: Json
          entity: string
          entity_id: string | null
          id: number
        }
        Insert: {
          action: string
          created_at?: string
          detail?: Json
          entity: string
          entity_id?: string | null
          id?: number
        }
        Update: {
          action?: string
          created_at?: string
          detail?: Json
          entity?: string
          entity_id?: string | null
          id?: number
        }
        Relationships: []
      }
      dataset_versions: {
        Row: {
          created_at: string
          description: string | null
          filters: Json
          id: string
          name: string
          sample_count: number
          total_duration_sec: number
        }
        Insert: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          name: string
          sample_count?: number
          total_duration_sec?: number
        }
        Update: {
          created_at?: string
          description?: string | null
          filters?: Json
          id?: string
          name?: string
          sample_count?: number
          total_duration_sec?: number
        }
        Relationships: []
      }
      export_snapshots: {
        Row: {
          created_at: string
          format: string
          id: string
          manifest: Json
          sample_count: number
          storage_path: string | null
          version_id: string | null
        }
        Insert: {
          created_at?: string
          format: string
          id?: string
          manifest?: Json
          sample_count?: number
          storage_path?: string | null
          version_id?: string | null
        }
        Update: {
          created_at?: string
          format?: string
          id?: string
          manifest?: Json
          sample_count?: number
          storage_path?: string | null
          version_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "export_snapshots_version_id_fkey"
            columns: ["version_id"]
            isOneToOne: false
            referencedRelation: "dataset_versions"
            referencedColumns: ["id"]
          },
        ]
      }
      prompts: {
        Row: {
          category: string
          created_at: string
          difficulty: string
          emotion: string | null
          est_duration_sec: number
          id: string
          language_mix_pct: number
          length_bucket: string
          metadata: Json
          noise_level: string | null
          normalized_text: string
          seed: number | null
          speaking_style: string | null
          text: string
          token_count: number
        }
        Insert: {
          category: string
          created_at?: string
          difficulty?: string
          emotion?: string | null
          est_duration_sec?: number
          id?: string
          language_mix_pct?: number
          length_bucket?: string
          metadata?: Json
          noise_level?: string | null
          normalized_text: string
          seed?: number | null
          speaking_style?: string | null
          text: string
          token_count?: number
        }
        Update: {
          category?: string
          created_at?: string
          difficulty?: string
          emotion?: string | null
          est_duration_sec?: number
          id?: string
          language_mix_pct?: number
          length_bucket?: string
          metadata?: Json
          noise_level?: string | null
          normalized_text?: string
          seed?: number | null
          speaking_style?: string | null
          text?: string
          token_count?: number
        }
        Relationships: []
      }
      qa_results: {
        Row: {
          cer: number | null
          created_at: string
          flags: Json
          id: string
          language_drift: boolean | null
          notes: string | null
          quality_score: number
          sample_id: string
          transcript: string | null
          wer: number | null
        }
        Insert: {
          cer?: number | null
          created_at?: string
          flags?: Json
          id?: string
          language_drift?: boolean | null
          notes?: string | null
          quality_score?: number
          sample_id: string
          transcript?: string | null
          wer?: number | null
        }
        Update: {
          cer?: number | null
          created_at?: string
          flags?: Json
          id?: string
          language_drift?: boolean | null
          notes?: string | null
          quality_score?: number
          sample_id?: string
          transcript?: string | null
          wer?: number | null
        }
        Relationships: [
          {
            foreignKeyName: "qa_results_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: false
            referencedRelation: "audio_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      reviews: {
        Row: {
          created_at: string
          edited_transcript: string | null
          id: string
          reviewed_at: string | null
          reviewer_id: string | null
          reviewer_notes: string | null
          sample_id: string
          status: string
          tags: Json
        }
        Insert: {
          created_at?: string
          edited_transcript?: string | null
          id?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          sample_id: string
          status?: string
          tags?: Json
        }
        Update: {
          created_at?: string
          edited_transcript?: string | null
          id?: string
          reviewed_at?: string | null
          reviewer_id?: string | null
          reviewer_notes?: string | null
          sample_id?: string
          status?: string
          tags?: Json
        }
        Relationships: [
          {
            foreignKeyName: "reviews_sample_id_fkey"
            columns: ["sample_id"]
            isOneToOne: true
            referencedRelation: "audio_samples"
            referencedColumns: ["id"]
          },
        ]
      }
      synthesis_jobs: {
        Row: {
          attempts: number
          audio_sample_id: string | null
          created_at: string
          error: string | null
          fingerprint: string
          finished_at: string | null
          id: string
          max_attempts: number
          next_run_at: string
          params: Json
          prompt_id: string
          started_at: string | null
          status: string
          voice_id: string | null
        }
        Insert: {
          attempts?: number
          audio_sample_id?: string | null
          created_at?: string
          error?: string | null
          fingerprint: string
          finished_at?: string | null
          id?: string
          max_attempts?: number
          next_run_at?: string
          params?: Json
          prompt_id: string
          started_at?: string | null
          status?: string
          voice_id?: string | null
        }
        Update: {
          attempts?: number
          audio_sample_id?: string | null
          created_at?: string
          error?: string | null
          fingerprint?: string
          finished_at?: string | null
          id?: string
          max_attempts?: number
          next_run_at?: string
          params?: Json
          prompt_id?: string
          started_at?: string | null
          status?: string
          voice_id?: string | null
        }
        Relationships: [
          {
            foreignKeyName: "synthesis_jobs_prompt_id_fkey"
            columns: ["prompt_id"]
            isOneToOne: false
            referencedRelation: "prompts"
            referencedColumns: ["id"]
          },
          {
            foreignKeyName: "synthesis_jobs_voice_id_fkey"
            columns: ["voice_id"]
            isOneToOne: false
            referencedRelation: "voices"
            referencedColumns: ["id"]
          },
        ]
      }
      voices: {
        Row: {
          created_at: string
          gender: string
          id: string
          is_active: boolean
          label: string
          language: string
          provider: string
          voice_id: string
        }
        Insert: {
          created_at?: string
          gender?: string
          id?: string
          is_active?: boolean
          label: string
          language?: string
          provider?: string
          voice_id: string
        }
        Update: {
          created_at?: string
          gender?: string
          id?: string
          is_active?: boolean
          label?: string
          language?: string
          provider?: string
          voice_id?: string
        }
        Relationships: []
      }
    }
    Views: {
      [_ in never]: never
    }
    Functions: {
      [_ in never]: never
    }
    Enums: {
      [_ in never]: never
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"] &
        DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Views"])
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  TableName extends DefaultSchemaTableNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions["schema"]]["Tables"]
    : never = never,
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
  EnumName extends DefaultSchemaEnumNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions["schema"]]["Enums"]
    : never = never,
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
  CompositeTypeName extends PublicCompositeTypeNameOrOptions extends {
    schema: keyof DatabaseWithoutInternals
  }
    ? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"]
    : never = never,
> = PublicCompositeTypeNameOrOptions extends {
  schema: keyof DatabaseWithoutInternals
}
  ? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions["schema"]]["CompositeTypes"][CompositeTypeName]
  : PublicCompositeTypeNameOrOptions extends keyof DefaultSchema["CompositeTypes"]
    ? DefaultSchema["CompositeTypes"][PublicCompositeTypeNameOrOptions]
    : never

export const Constants = {
  public: {
    Enums: {},
  },
} as const
