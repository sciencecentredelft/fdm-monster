import { Column, Entity, OneToMany, PrimaryGeneratedColumn, type Relation } from "typeorm";
import { FloorPosition } from "./floor-position.entity";

@Entity()
export class Floor {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  name: string;

  @Column()
  order: number;

  @Column({ type: "varchar", nullable: true, select: false })
  gridPasswordHash: string | null;

  @Column({ type: "varchar", nullable: true })
  gridLockVersion: string | null;

  @OneToMany(() => FloorPosition, (gp) => gp.floor, { eager: true })
  printers: Relation<FloorPosition>[];
}
