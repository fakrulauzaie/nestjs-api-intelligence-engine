import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { AppController } from './app.controller';
import { AppService } from './app.service';
import { Note } from './notes/entities/note.entity';
import { NotesModule } from './notes/notes.module';
import { AuditRecord } from './notes/entities/audit-record.entity';

@Module({
  imports: [
    TypeOrmModule.forRoot({
      type: 'better-sqlite3' as any,
      database: 'db.sqlite',
      entities: [Note, AuditRecord],
      synchronize: true, // Only for development/testing
    }),
    NotesModule,
  ],
  controllers: [AppController],
  providers: [AppService],
})
export class AppModule { }
