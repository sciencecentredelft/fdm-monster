import type { MigrationInterface, QueryRunner } from "typeorm";

export class IndexPrintJobActiveLookup1778446203019 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query(
      'CREATE INDEX "IDX_print_job_printer_status_started_at" ON "print_job" ("printerId", "status", "startedAt")',
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.query('DROP INDEX "IDX_print_job_printer_status_started_at"');
  }
}
