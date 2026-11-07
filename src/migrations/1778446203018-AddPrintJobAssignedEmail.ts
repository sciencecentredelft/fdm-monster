import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddPrintJobAssignedEmail1778446203018 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumn(
      "print_job",
      new TableColumn({ name: "assignedEmail", type: "varchar", isNullable: true }),
    );
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumn("print_job", "assignedEmail");
  }
}
