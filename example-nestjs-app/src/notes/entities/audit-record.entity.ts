import { Column, Entity, PrimaryGeneratedColumn } from 'typeorm';

@Entity('audit_log')
export class AuditRecord {
  @PrimaryGeneratedColumn()
  id: number;

  @Column()
  action: string;
}
