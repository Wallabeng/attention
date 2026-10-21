import {Component, computed, OnInit, signal} from '@angular/core';
import {FormsModule} from '@angular/forms';
import {MatButtonModule} from '@angular/material/button';
import {MatFormFieldModule} from '@angular/material/form-field';
import {MatIconModule} from '@angular/material/icon';
import {MatInputModule} from '@angular/material/input';
import {MatSortModule, Sort} from '@angular/material/sort';
import {MatTableModule} from '@angular/material/table';
import {ConfigService} from '../config.service';
import {ShellService} from '../shell.service';
import {fetchNamespaceRows, ServiceBusEntityRow} from './servicebus-api.util';

@Component({
  selector: 'app-servicebus',
  standalone: true,
  imports: [FormsModule, MatButtonModule, MatFormFieldModule, MatIconModule, MatInputModule, MatSortModule, MatTableModule],
  templateUrl: './servicebus.component.html',
  styleUrl: './servicebus.component.scss',
})
export class ServiceBusComponent implements OnInit {
  readonly columns = ['namespace', 'type', 'name', 'active', 'deadLetter', 'scheduled', 'transfer', 'total'];

  configured = signal(false);
  loading = signal(false);
  /** One message per namespace that failed — other namespaces' rows still show. */
  errors = signal<string[]>([]);
  rows = signal<ServiceBusEntityRow[]>([]);
  filterText = signal('');
  sort = signal<Sort>({active: 'namespace', direction: 'asc'});

  readonly visibleRows = computed(() => {
    const needle = this.filterText().trim().toLowerCase();
    const rows = needle
      ? this.rows().filter(r => `${r.namespace} ${r.type} ${r.name}`.toLowerCase().includes(needle))
      : [...this.rows()];
    const {active, direction} = this.sort();
    if (!direction) return rows;
    const factor = direction === 'asc' ? 1 : -1;
    const key = active as keyof ServiceBusEntityRow;
    return rows.sort((a, b) => {
      const x = a[key], y = b[key];
      return factor * (typeof x === 'number' && typeof y === 'number' ? x - y : String(x).localeCompare(String(y)));
    });
  });

  constructor(private config: ConfigService, private shell: ShellService) {
  }

  ngOnInit(): Promise<void> {
    return this.refresh();
  }

  async refresh(): Promise<void> {
    if (this.loading()) return;
    this.loading.set(true);
    try {
      const namespaces = (await this.config.get()).servicebus_namespaces ?? [];
      const http = (url: string, method: string, headers: [string, string][], body: string | null) =>
        this.shell.httpRequest(url, method, headers, body);
      const withEntities = namespaces.filter(ns => ns.entities.length > 0);
      this.configured.set(withEntities.length > 0);
      const token = withEntities.length > 0 ? await this.shell.azureAccessToken() : '';
      const results = await Promise.all(withEntities.map(ns => fetchNamespaceRows(http, token, ns)));
      this.rows.set(results.flatMap(r => r.rows));
      this.errors.set(results.flatMap(r => r.errors));
    } catch (e) {
      this.errors.set([e instanceof Error ? e.message : String(e)]);
    } finally {
      this.loading.set(false);
    }
  }
}
