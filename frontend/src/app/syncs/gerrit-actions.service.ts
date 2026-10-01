import {Injectable} from '@angular/core';
import {ConfigService} from '../config.service';
import {Item} from '../item.model';
import {ActionProvider, ItemAction} from './item-action';
import {ShellService} from '../shell.service';

@Injectable()
export class GerritActionsService extends ActionProvider {
  override readonly source = 'gerrit';

  constructor(private configService: ConfigService, private shell: ShellService) {
    super();
  }

  override getActions(_item: Item): ItemAction[] {
    return [
      {
        id: 'ai-review',
        label: 'AI Review',
        icon: 'auto_awesome',
        destructive: false,
        run: item => this.runAiReview(item),
      },
    ];
  }

  private async runAiReview(item: Item): Promise<void> {
    const config = await this.configService.get();
    if (!config.gerrit_repos_root) {
      throw new Error('Gerrit local repos root is not configured');
    }

    const fullProject = item.properties?.['Project'];
    if (!fullProject) {
      throw new Error('Gerrit item has no Project property');
    }

    const project = fullProject.split('/').pop();

    const changeNumber = item.id.replace(/^gerrit-/, '');
    const workingDir = `${config.gerrit_repos_root}/${project}`;
    const command = `copilot -i "review gerrit change ${changeNumber} and post draft comments"`;
    const allowTools = ` --allow-tool='gerrit(list_change_files),gerrit(get_commit_message),gerrit(get_change_details),gerrit(list_change_comments),gerrit(list_draft_comments),gerrit(get_file_diff),gerrit(post_draft_comment)'`;
    const mcps = ` --enable-mcp-server gerrit`;

    await this.shell.runInTerminal(command + allowTools + mcps, workingDir);
  }
}
