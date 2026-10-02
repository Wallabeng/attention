import { TestBed } from '@angular/core/testing';
import { AppComponent } from './app.component';
import {ItemsService} from './items.service';
import {SourcesService} from './sources.service';
import {ShellService} from './shell.service';
import {MatDialog} from '@angular/material/dialog';
import {MatSnackBar} from '@angular/material/snack-bar';
import {WhatsNewService} from './whats-new/whats-new.service';

describe('AppComponent', () => {
  beforeEach(async () => {
    TestBed.overrideComponent(AppComponent, {
      set: {template: ''},
    });

    await TestBed.configureTestingModule({
      imports: [AppComponent],
      providers: [
        {
          provide: ItemsService,
          useValue: {
            load: () => undefined,
          },
        },
        {
          provide: SourcesService,
          useValue: {
            load: () => undefined,
          },
        },
        {
          provide: ShellService,
          useValue: {
            requestNotificationPermission: () => undefined,
          },
        },
        {
          provide: MatDialog,
          useValue: {open: () => undefined},
        },
        {
          provide: WhatsNewService,
          useValue: {showIfNew: () => Promise.resolve()},
        },
        {
          provide: MatSnackBar,
          useValue: {open: () => undefined},
        },
      ],
    }).compileComponents();
  });

  it('should create the app', () => {
    const fixture = TestBed.createComponent(AppComponent);
    const app = fixture.componentInstance;
    expect(app).toBeTruthy();
  });
});
