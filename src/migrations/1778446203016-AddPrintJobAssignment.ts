import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddPrintJobAssignment1778446203016 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "print_job",
      new TableColumn({ name: "assignedTo", type: "varchar", isNullable: true }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("print_job", "assignedTo");
  }
}
