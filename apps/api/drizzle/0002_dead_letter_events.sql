CREATE TABLE "dead_letter_events" (
	"id" uuid PRIMARY KEY DEFAULT gen_random_uuid() NOT NULL,
	"execution_id" uuid NOT NULL,
	"step_id" uuid,
	"workflow_id" uuid NOT NULL,
	"node_id" uuid,
	"payload" jsonb DEFAULT '{}'::jsonb,
	"error" jsonb NOT NULL,
	"retry_count" integer DEFAULT 0 NOT NULL,
	"created_at" timestamp with time zone DEFAULT now() NOT NULL
);
--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_execution_id_executions_id_fk" FOREIGN KEY ("execution_id") REFERENCES "public"."executions"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_step_id_execution_steps_id_fk" FOREIGN KEY ("step_id") REFERENCES "public"."execution_steps"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_workflow_id_workflows_id_fk" FOREIGN KEY ("workflow_id") REFERENCES "public"."workflows"("id") ON DELETE cascade ON UPDATE no action;--> statement-breakpoint
ALTER TABLE "dead_letter_events" ADD CONSTRAINT "dead_letter_events_node_id_workflow_nodes_id_fk" FOREIGN KEY ("node_id") REFERENCES "public"."workflow_nodes"("id") ON DELETE set null ON UPDATE no action;--> statement-breakpoint
CREATE INDEX "idx_dle_execution" ON "dead_letter_events" USING btree ("execution_id");--> statement-breakpoint
CREATE INDEX "idx_dle_workflow" ON "dead_letter_events" USING btree ("workflow_id");--> statement-breakpoint
CREATE INDEX "idx_dle_created" ON "dead_letter_events" USING btree ("created_at");