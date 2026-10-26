import { MigrationInterface, QueryRunner, TableColumn } from "typeorm";

export class AddFloorGridLock1778446203017 implements MigrationInterface {
  async up(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.addColumns("floor", [
      new TableColumn({ name: "gridPasswordHash", type: "varchar", isNullable: true }),
      new TableColumn({ name: "gridLockVersion", type: "varchar", isNullable: true }),
    ]);
  }

  async down(queryRunner: QueryRunner): Promise<void> {
    await queryRunner.dropColumns("floor", ["gridPasswordHash", "gridLockVersion"]);
  }
}
