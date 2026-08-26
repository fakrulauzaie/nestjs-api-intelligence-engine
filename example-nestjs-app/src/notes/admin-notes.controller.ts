import { Controller, Get, UseGuards } from '@nestjs/common';
import { AuditGuard } from '../auth/audit.guard';
import { AuthGuard } from '../auth/auth.guard';
import { NotesService } from './notes.service';

@Controller('admin/notes')
@UseGuards(AuthGuard)
export class AdminNotesController {
  constructor(private readonly notesService: NotesService) {}

  @Get('count')
  @UseGuards(AuditGuard)
  async count() {
    return this.notesService.count();
  }
}
