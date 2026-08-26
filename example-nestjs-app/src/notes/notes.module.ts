import { Module } from '@nestjs/common';
import { TypeOrmModule } from '@nestjs/typeorm';
import { NotesController } from './notes.controller';
import { NotesService } from './notes.service';
import { Note } from './entities/note.entity';
import { AdminNotesController } from './admin-notes.controller';
import { NotesFormatterService } from './notes-formatter.service';
import {
  LEGACY_SINK_TOKEN,
  LegacyNotifierService,
} from './legacy-notifier.service';

@Module({
  imports: [TypeOrmModule.forFeature([Note])],
  controllers: [NotesController, AdminNotesController],
  providers: [
    NotesService,
    NotesFormatterService,
    LegacyNotifierService,
    {
      provide: LEGACY_SINK_TOKEN,
      useValue: { write: (_message: string) => undefined },
    },
  ],
})
export class NotesModule {}
