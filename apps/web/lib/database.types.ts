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
				Args: { extensions?: Json; operationName?: string; query?: string; variables?: Json };
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
			audit_events: {
				Row: {
					action: string;
					actor_email: string | null;
					actor_user_id: string | null;
					created_at: string;
					details: NonNullable<Json>;
					id: string;
					shop_id: string;
					subject_id: string | null;
				};
				ComputedFields: never;
				Insert: {
					action: string;
					actor_email?: string | null;
					actor_user_id?: string | null;
					created_at?: string;
					details?: NonNullable<Json>;
					id?: string;
					shop_id: string;
					subject_id?: string | null;
				};
				Update: {
					action?: string;
					actor_email?: string | null;
					actor_user_id?: string | null;
					created_at?: string;
					details?: NonNullable<Json>;
					id?: string;
					shop_id?: string;
					subject_id?: string | null;
				};
				Relationships: [
					{
						foreignKeyName: 'audit_events_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			availability_rules: {
				Row: {
					created_at: string;
					end_time: string;
					id: string;
					shop_id: string;
					staff_id: string;
					start_time: string;
					weekday: number;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					end_time: string;
					id?: string;
					shop_id: string;
					staff_id: string;
					start_time: string;
					weekday: number;
				};
				Update: {
					created_at?: string;
					end_time?: string;
					id?: string;
					shop_id?: string;
					staff_id?: string;
					start_time?: string;
					weekday?: number;
				};
				Relationships: [
					{
						foreignKeyName: 'availability_rules_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'availability_rules_staff_same_shop_fk';
						columns: ['shop_id', 'staff_id'];
						isOneToOne: false;
						referencedRelation: 'staff';
						referencedColumns: ['shop_id', 'id'];
					},
				];
			};
			booking_links: {
				Row: {
					booking_id: string;
					created_at: string;
					expires_at: string;
					id: string;
					revoked_at: string | null;
					shop_id: string;
					token_hash: string;
				};
				ComputedFields: never;
				Insert: {
					booking_id: string;
					created_at?: string;
					expires_at: string;
					id?: string;
					revoked_at?: string | null;
					shop_id: string;
					token_hash: string;
				};
				Update: {
					booking_id?: string;
					created_at?: string;
					expires_at?: string;
					id?: string;
					revoked_at?: string | null;
					shop_id?: string;
					token_hash?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'booking_links_booking_same_shop_fk';
						columns: ['shop_id', 'booking_id'];
						isOneToOne: false;
						referencedRelation: 'bookings';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'booking_links_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			bookings: {
				Row: {
					blocked_until: string;
					cancel_reason: string | null;
					cancelled_at: string | null;
					client_id: string;
					client_notes: string | null;
					created_at: string;
					deposit_cents: number;
					during: unknown;
					ends_at: string;
					id: string;
					outcome_marked_at: string | null;
					pending_expires_at: string | null;
					price_cents: number;
					risk_model_version: string | null;
					risk_score: number | null;
					service_id: string;
					shop_id: string;
					source: string;
					staff_id: string;
					starts_at: string;
					status: string;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					blocked_until: string;
					cancel_reason?: string | null;
					cancelled_at?: string | null;
					client_id: string;
					client_notes?: string | null;
					created_at?: string;
					deposit_cents?: number;
					during?: never;
					ends_at: string;
					id?: string;
					outcome_marked_at?: string | null;
					pending_expires_at?: string | null;
					price_cents: number;
					risk_model_version?: string | null;
					risk_score?: number | null;
					service_id: string;
					shop_id: string;
					source?: string;
					staff_id: string;
					starts_at: string;
					status: string;
					updated_at?: string;
				};
				Update: {
					blocked_until?: string;
					cancel_reason?: string | null;
					cancelled_at?: string | null;
					client_id?: string;
					client_notes?: string | null;
					created_at?: string;
					deposit_cents?: number;
					during?: never;
					ends_at?: string;
					id?: string;
					outcome_marked_at?: string | null;
					pending_expires_at?: string | null;
					price_cents?: number;
					risk_model_version?: string | null;
					risk_score?: number | null;
					service_id?: string;
					shop_id?: string;
					source?: string;
					staff_id?: string;
					starts_at?: string;
					status?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'bookings_client_same_shop_fk';
						columns: ['shop_id', 'client_id'];
						isOneToOne: false;
						referencedRelation: 'client_stats';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'bookings_client_same_shop_fk';
						columns: ['shop_id', 'client_id'];
						isOneToOne: false;
						referencedRelation: 'clients';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'bookings_service_same_shop_fk';
						columns: ['shop_id', 'service_id'];
						isOneToOne: false;
						referencedRelation: 'services';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'bookings_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'bookings_staff_same_shop_fk';
						columns: ['shop_id', 'staff_id'];
						isOneToOne: false;
						referencedRelation: 'staff';
						referencedColumns: ['shop_id', 'id'];
					},
				];
			};
			client_notes: {
				Row: {
					author_user_id: string | null;
					body: string;
					client_id: string;
					created_at: string;
					id: string;
					shop_id: string;
				};
				ComputedFields: never;
				Insert: {
					author_user_id?: string | null;
					body: string;
					client_id: string;
					created_at?: string;
					id?: string;
					shop_id: string;
				};
				Update: {
					author_user_id?: string | null;
					body?: string;
					client_id?: string;
					created_at?: string;
					id?: string;
					shop_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'client_notes_client_same_shop_fk';
						columns: ['shop_id', 'client_id'];
						isOneToOne: false;
						referencedRelation: 'client_stats';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'client_notes_client_same_shop_fk';
						columns: ['shop_id', 'client_id'];
						isOneToOne: false;
						referencedRelation: 'clients';
						referencedColumns: ['shop_id', 'id'];
					},
					{
						foreignKeyName: 'client_notes_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			clients: {
				Row: {
					anonymised_at: string | null;
					created_at: string;
					email: string | null;
					first_source: string | null;
					id: string;
					marketing_opt_in: boolean;
					marketing_opt_in_at: string | null;
					marketing_opt_in_method: string | null;
					name: string;
					phone_e164: string | null;
					shop_id: string;
					sms_opted_out: boolean;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					anonymised_at?: string | null;
					created_at?: string;
					email?: string | null;
					first_source?: string | null;
					id?: string;
					marketing_opt_in?: boolean;
					marketing_opt_in_at?: string | null;
					marketing_opt_in_method?: string | null;
					name: string;
					phone_e164?: string | null;
					shop_id: string;
					sms_opted_out?: boolean;
					updated_at?: string;
				};
				Update: {
					anonymised_at?: string | null;
					created_at?: string;
					email?: string | null;
					first_source?: string | null;
					id?: string;
					marketing_opt_in?: boolean;
					marketing_opt_in_at?: string | null;
					marketing_opt_in_method?: string | null;
					name?: string;
					phone_e164?: string | null;
					shop_id?: string;
					sms_opted_out?: boolean;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'clients_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			public_rate_limits: {
				Row: {
					hits: number;
					key: string;
					window_start: string;
				};
				ComputedFields: never;
				Insert: {
					hits?: number;
					key: string;
					window_start: string;
				};
				Update: {
					hits?: number;
					key?: string;
					window_start?: string;
				};
				Relationships: [];
			};
			services: {
				Row: {
					active: boolean;
					buffer_minutes: number;
					created_at: string;
					deposit_cents: number;
					duration_minutes: number;
					id: string;
					name: string;
					price_cents: number;
					shop_id: string;
					sort_order: number;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					active?: boolean;
					buffer_minutes?: number;
					created_at?: string;
					deposit_cents?: number;
					duration_minutes: number;
					id?: string;
					name: string;
					price_cents: number;
					shop_id: string;
					sort_order?: number;
					updated_at?: string;
				};
				Update: {
					active?: boolean;
					buffer_minutes?: number;
					created_at?: string;
					deposit_cents?: number;
					duration_minutes?: number;
					id?: string;
					name?: string;
					price_cents?: number;
					shop_id?: string;
					sort_order?: number;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'services_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			shop_members: {
				Row: {
					created_at: string;
					role: string;
					shop_id: string;
					staff_id: string | null;
					user_id: string;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					role: string;
					shop_id: string;
					staff_id?: string | null;
					user_id: string;
				};
				Update: {
					created_at?: string;
					role?: string;
					shop_id?: string;
					staff_id?: string | null;
					user_id?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'shop_members_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'shop_members_staff_same_shop_fk';
						columns: ['shop_id', 'staff_id'];
						isOneToOne: false;
						referencedRelation: 'staff';
						referencedColumns: ['shop_id', 'id'];
					},
				];
			};
			shops: {
				Row: {
					about_text: string | null;
					address: string | null;
					booking_page_enabled: boolean;
					cancel_cutoff_hours: number;
					created_at: string;
					currency: string;
					id: string;
					logo_url: string | null;
					max_active_bookings_per_phone: number;
					max_horizon_days: number;
					min_lead_minutes: number;
					name: string;
					phone: string | null;
					slot_step_minutes: number;
					slug: string;
					timezone: string;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					about_text?: string | null;
					address?: string | null;
					booking_page_enabled?: boolean;
					cancel_cutoff_hours?: number;
					created_at?: string;
					currency?: string;
					id?: string;
					logo_url?: string | null;
					max_active_bookings_per_phone?: number;
					max_horizon_days?: number;
					min_lead_minutes?: number;
					name: string;
					phone?: string | null;
					slot_step_minutes?: number;
					slug: string;
					timezone: string;
					updated_at?: string;
				};
				Update: {
					about_text?: string | null;
					address?: string | null;
					booking_page_enabled?: boolean;
					cancel_cutoff_hours?: number;
					created_at?: string;
					currency?: string;
					id?: string;
					logo_url?: string | null;
					max_active_bookings_per_phone?: number;
					max_horizon_days?: number;
					min_lead_minutes?: number;
					name?: string;
					phone?: string | null;
					slot_step_minutes?: number;
					slug?: string;
					timezone?: string;
					updated_at?: string;
				};
				Relationships: [];
			};
			staff: {
				Row: {
					active: boolean;
					created_at: string;
					display_name: string;
					id: string;
					shop_id: string;
					updated_at: string;
				};
				ComputedFields: never;
				Insert: {
					active?: boolean;
					created_at?: string;
					display_name: string;
					id?: string;
					shop_id: string;
					updated_at?: string;
				};
				Update: {
					active?: boolean;
					created_at?: string;
					display_name?: string;
					id?: string;
					shop_id?: string;
					updated_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'staff_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
			time_off: {
				Row: {
					created_at: string;
					ends_at: string;
					id: string;
					reason: string | null;
					shop_id: string;
					staff_id: string;
					starts_at: string;
				};
				ComputedFields: never;
				Insert: {
					created_at?: string;
					ends_at: string;
					id?: string;
					reason?: string | null;
					shop_id: string;
					staff_id: string;
					starts_at: string;
				};
				Update: {
					created_at?: string;
					ends_at?: string;
					id?: string;
					reason?: string | null;
					shop_id?: string;
					staff_id?: string;
					starts_at?: string;
				};
				Relationships: [
					{
						foreignKeyName: 'time_off_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
					{
						foreignKeyName: 'time_off_staff_same_shop_fk';
						columns: ['shop_id', 'staff_id'];
						isOneToOne: false;
						referencedRelation: 'staff';
						referencedColumns: ['shop_id', 'id'];
					},
				];
			};
			webhook_events: {
				Row: {
					event_id: string;
					provider: string;
					received_at: string;
				};
				ComputedFields: never;
				Insert: {
					event_id: string;
					provider: string;
					received_at?: string;
				};
				Update: {
					event_id?: string;
					provider?: string;
					received_at?: string;
				};
				Relationships: [];
			};
		};
		Views: {
			client_stats: {
				Row: {
					anonymised_at: string | null;
					avg_spend_cents: number | null;
					cancellations: number | null;
					created_at: string | null;
					email: string | null;
					id: string | null;
					last_visit_at: string | null;
					name: string | null;
					next_booking_at: string | null;
					no_shows: number | null;
					phone_e164: string | null;
					shop_id: string | null;
					total_bookings: number | null;
					visits: number | null;
				};
				ComputedFields: never;
				Relationships: [
					{
						foreignKeyName: 'clients_shop_id_fkey';
						columns: ['shop_id'];
						isOneToOne: false;
						referencedRelation: 'shops';
						referencedColumns: ['id'];
					},
				];
			};
		};
		Functions: {
			anonymise_client: { Args: { p_client_id: string }; Returns: undefined };
			create_public_booking: {
				Args: {
					p_blocked_until: string;
					p_client_name: string;
					p_email: string;
					p_ends_at: string;
					p_link_expires_at: string;
					p_marketing_opt_in: boolean;
					p_notes: string;
					p_phone_e164: string;
					p_price_cents: number;
					p_service_id: string;
					p_shop_id: string;
					p_source: string;
					p_staff_id: string;
					p_starts_at: string;
					p_token_hash: string;
				};
				Returns: {
					booking_id: string;
					client_id: string;
				}[];
			};
			create_staff_booking: {
				Args: {
					p_blocked_until: string;
					p_client_id?: string;
					p_client_name: string;
					p_ends_at: string;
					p_notes: string;
					p_phone_e164?: string;
					p_price_cents: number;
					p_service_id: string;
					p_shop_id: string;
					p_source: string;
					p_staff_id: string;
					p_starts_at: string;
				};
				Returns: {
					booking_id: string;
					client_id: string;
				}[];
			};
			hit_rate_limit: {
				Args: { p_key: string; p_max: number; p_window_seconds: number };
				Returns: {
					allowed: boolean;
					retry_after_seconds: number;
				}[];
			};
			is_own_staff: { Args: { p_shop_id: string; p_staff_id: string }; Returns: boolean };
			is_shop_member: { Args: { p_shop_id: string }; Returns: boolean };
			is_shop_owner: { Args: { p_shop_id: string }; Returns: boolean };
			merge_clients: {
				Args: { p_contact?: Json; p_keep_id: string; p_merge_id: string };
				Returns: string;
			};
			onboard_shop: { Args: { p_payload: Json; p_user_id: string }; Returns: string };
			reorder_services: {
				Args: { p_service_ids: string[]; p_shop_id: string };
				Returns: undefined;
			};
			replace_availability_rules: {
				Args: { p_rules: Json; p_staff_id: string };
				Returns: undefined;
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

type DatabaseWithoutInternals = Omit<Database, '__InternalSupabase'>;

type DefaultSchema = DatabaseWithoutInternals[Extract<keyof Database, 'public'>];

export type Tables<
	DefaultSchemaTableNameOrOptions extends
		| keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		| { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
				DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])
		: never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
	? (DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'] &
			DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Views'])[TableName] extends {
			Row: infer R;
		}
		? R
		: never
	: DefaultSchemaTableNameOrOptions extends keyof (DefaultSchema['Tables'] & DefaultSchema['Views'])
		? (DefaultSchema['Tables'] & DefaultSchema['Views'])[DefaultSchemaTableNameOrOptions] extends {
				Row: infer R;
			}
			? R
			: never
		: never;

export type TablesInsert<
	DefaultSchemaTableNameOrOptions extends
		keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Insert: infer I;
		}
		? I
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Insert: infer I;
			}
			? I
			: never
		: never;

export type TablesUpdate<
	DefaultSchemaTableNameOrOptions extends
		keyof DefaultSchema['Tables'] | { schema: keyof DatabaseWithoutInternals },
	TableName extends (DefaultSchemaTableNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables']
		: never) = never,
> = DefaultSchemaTableNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
	? DatabaseWithoutInternals[DefaultSchemaTableNameOrOptions['schema']]['Tables'][TableName] extends {
			Update: infer U;
		}
		? U
		: never
	: DefaultSchemaTableNameOrOptions extends keyof DefaultSchema['Tables']
		? DefaultSchema['Tables'][DefaultSchemaTableNameOrOptions] extends {
				Update: infer U;
			}
			? U
			: never
		: never;

export type Enums<
	DefaultSchemaEnumNameOrOptions extends
		keyof DefaultSchema['Enums'] | { schema: keyof DatabaseWithoutInternals },
	EnumName extends (DefaultSchemaEnumNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums']
		: never) = never,
> = DefaultSchemaEnumNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
	? DatabaseWithoutInternals[DefaultSchemaEnumNameOrOptions['schema']]['Enums'][EnumName]
	: DefaultSchemaEnumNameOrOptions extends keyof DefaultSchema['Enums']
		? DefaultSchema['Enums'][DefaultSchemaEnumNameOrOptions]
		: never;

export type CompositeTypes<
	PublicCompositeTypeNameOrOptions extends
		keyof DefaultSchema['CompositeTypes'] | { schema: keyof DatabaseWithoutInternals },
	CompositeTypeName extends (PublicCompositeTypeNameOrOptions extends {
		schema: keyof DatabaseWithoutInternals;
	}
		? keyof DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes']
		: never) = never,
> = PublicCompositeTypeNameOrOptions extends { schema: keyof DatabaseWithoutInternals }
	? DatabaseWithoutInternals[PublicCompositeTypeNameOrOptions['schema']]['CompositeTypes'][CompositeTypeName]
	: PublicCompositeTypeNameOrOptions extends keyof DefaultSchema['CompositeTypes']
		? DefaultSchema['CompositeTypes'][PublicCompositeTypeNameOrOptions]
		: never;

export const Constants = {
	graphql_public: {
		Enums: {},
	},
	public: {
		Enums: {},
	},
} as const;
