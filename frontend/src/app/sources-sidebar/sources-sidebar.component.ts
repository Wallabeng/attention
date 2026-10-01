import { Component } from '@angular/core';
import { MatIconModule } from '@angular/material/icon';
import { MatSlideToggleModule } from '@angular/material/slide-toggle';
import { MatTooltipModule } from '@angular/material/tooltip';
import { ItemsService } from '../items.service';
import { SourcesService, SyncResult } from '../sources.service';

@Component({
  selector: 'app-sources-sidebar',
  standalone: true,
  imports: [MatIconModule, MatSlideToggleModule, MatTooltipModule],
  templateUrl: './sources-sidebar.component.html',
  styleUrl: './sources-sidebar.component.scss',
})
export class SourcesSidebarComponent {
  constructor(public sources: SourcesService, public items: ItemsService) {}

  openCount(source: string): number {
    return this.items.items().filter(i => i.source === source && i.state === 'open').length;
  }

  syncResult(source: string): SyncResult | null {
    return this.sources.syncResults().get(source) ?? null;
  }
}
