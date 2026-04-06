/**
 * Topic Commands
 *
 * Manage the topic catalog: list, add, update, deactivate,
 * stats, backfill, and classify text.
 */

import type { Command } from 'commander';
import { resolveConfig } from '../config.js';
import { apiGet, apiPost, apiPatch, apiDelete } from '../http.js';
import { printJson, printTable, printSuccess, printError } from '../output.js';

interface AdminTopic {
  slug: string;
  name: string;
  description: string | null;
  parentSlug: string | null;
  terms: string[];
  contextTerms: string[];
  antiTerms: string[];
  isActive: boolean;
  postCount: number;
  currentWeight: number | null;
  createdAt: string;
}

/** Register topic commands on the program. */
export function registerTopicCommands(program: Command): void {
  const topics = program.command('topics').description('Manage topic catalog');

  // ── List ──
  topics
    .command('list')
    .description('List all topics with post counts')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<AdminTopic[]>('/api/admin/topics', config);

        if (config.json) {
          printJson(data);
        } else {
          if (!data.length) {
            printSuccess('No topics in catalog.');
            return;
          }
          const rows = data.map((t) => [
            t.isActive ? t.name : `${t.name} (inactive)`,
            t.postCount,
            t.currentWeight !== null ? t.currentWeight.toFixed(2) : '—',
            t.terms.slice(0, 5).join(', ') + (t.terms.length > 5 ? ', ...' : ''),
          ]);
          printTable(['Topic', 'Posts', 'Weight', 'Terms'], rows);

          const activeCount = data.filter((t) => t.isActive).length;
          const totalPosts = data.reduce((sum, t) => sum + t.postCount, 0);
          console.log(`\n${activeCount} active topics, ${totalPosts} classified posts`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Add ──
  topics
    .command('add')
    .description('Add a new topic')
    .requiredOption('--slug <slug>', 'Topic slug (lowercase, hyphens)')
    .requiredOption('--name <name>', 'Display name')
    .requiredOption('--terms <terms>', 'Comma-separated primary terms')
    .option('--description <desc>', 'Topic description')
    .option('--context-terms <terms>', 'Comma-separated context terms')
    .option('--anti-terms <terms>', 'Comma-separated anti terms')
    .option('--parent <slug>', 'Parent topic slug')
    .action(async (opts: Record<string, string>) => {
      try {
        const config = resolveConfig(program.opts());

        const body = {
          slug: opts.slug,
          name: opts.name,
          description: opts.description,
          parentSlug: opts.parent,
          terms: opts.terms
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean),
          contextTerms: opts.contextTerms
            ? opts.contextTerms
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean)
            : [],
          antiTerms: opts.antiTerms
            ? opts.antiTerms
                .split(',')
                .map((t: string) => t.trim())
                .filter(Boolean)
            : [],
        };

        const data = await apiPost<Record<string, unknown>>('/api/admin/topics', body, config);

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(`Topic created: ${opts.name} (${opts.slug})`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Update ──
  topics
    .command('update')
    .description('Update a topic')
    .argument('<slug>', 'Topic slug to update')
    .option('--name <name>', 'New display name')
    .option('--terms <terms>', 'Replace all terms (comma-separated)')
    .option('--add-terms <terms>', 'Add terms (comma-separated)')
    .option('--remove-terms <terms>', 'Remove terms (comma-separated)')
    .option('--context-terms <terms>', 'Replace context terms')
    .option('--anti-terms <terms>', 'Replace anti terms')
    .action(async (slug: string, opts: Record<string, string>) => {
      try {
        const config = resolveConfig(program.opts());
        const body: Record<string, unknown> = {};

        if (opts.name) body.name = opts.name;

        if (opts.terms) {
          body.terms = opts.terms
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean);
        } else if (opts.addTerms || opts.removeTerms) {
          // Fetch current topic to merge terms
          const all = await apiGet<AdminTopic[]>('/api/admin/topics', config);
          const current = all.find((t) => t.slug === slug);
          if (!current) {
            printError(`Topic "${slug}" not found`);
            process.exitCode = 1;
            return;
          }

          const termSet = new Set(current.terms);
          if (opts.addTerms) {
            for (const t of opts.addTerms
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)) {
              termSet.add(t.toLowerCase());
            }
          }
          if (opts.removeTerms) {
            for (const t of opts.removeTerms
              .split(',')
              .map((s: string) => s.trim())
              .filter(Boolean)) {
              termSet.delete(t.toLowerCase());
            }
          }
          body.terms = Array.from(termSet);
        }

        if (opts.contextTerms) {
          body.contextTerms = opts.contextTerms
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean);
        }
        if (opts.antiTerms) {
          body.antiTerms = opts.antiTerms
            .split(',')
            .map((t: string) => t.trim())
            .filter(Boolean);
        }

        if (Object.keys(body).length === 0) {
          printError('No update fields provided');
          process.exitCode = 1;
          return;
        }

        const data = await apiPatch<Record<string, unknown>>(
          `/api/admin/topics/${encodeURIComponent(slug)}`,
          body,
          config,
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(`Topic updated: ${slug}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Deactivate ──
  topics
    .command('deactivate')
    .description('Soft deactivate a topic')
    .argument('<slug>', 'Topic slug to deactivate')
    .action(async (slug: string) => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiDelete<Record<string, unknown>>(
          `/api/admin/topics/${encodeURIComponent(slug)}`,
          config,
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(`Topic deactivated: ${slug}`);
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Stats ──
  topics
    .command('stats')
    .description('Show topic classification statistics')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<AdminTopic[]>('/api/admin/topics', config);

        const active = data.filter((t) => t.isActive);
        const withPosts = active.filter((t) => t.postCount > 0);
        const totalPosts = active.reduce((sum, t) => sum + t.postCount, 0);
        const topByPosts = [...active].sort((a, b) => b.postCount - a.postCount).slice(0, 5);
        const bottomByPosts = [...active].sort((a, b) => a.postCount - b.postCount).slice(0, 5);

        if (config.json) {
          printJson({
            totalTopics: data.length,
            activeTopics: active.length,
            topicsWithPosts: withPosts.length,
            totalClassifiedPosts: totalPosts,
            topByPosts: topByPosts.map((t) => ({ slug: t.slug, postCount: t.postCount })),
            bottomByPosts: bottomByPosts.map((t) => ({ slug: t.slug, postCount: t.postCount })),
          });
        } else {
          console.log(`Topic Statistics`);
          console.log(`  Total topics: ${data.length} (${active.length} active)`);
          console.log(`  Topics with posts: ${withPosts.length}`);
          console.log(`  Total classified posts: ${totalPosts}`);
          console.log(`\n  Most matched:`);
          for (const t of topByPosts) {
            console.log(`    ${t.name}: ${t.postCount} posts`);
          }
          console.log(`\n  Least matched:`);
          for (const t of bottomByPosts) {
            console.log(`    ${t.name}: ${t.postCount} posts`);
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Backfill ──
  topics
    .command('backfill')
    .description('Re-classify posts for a topic')
    .argument('<slug>', 'Topic slug to backfill')
    .action(async (slug: string) => {
      try {
        const config = resolveConfig(program.opts());
        console.log(`Backfilling topic: ${slug}...`);

        const data = await apiPost<{ classified: number; matched: number; elapsed_ms: number }>(
          `/api/admin/topics/${encodeURIComponent(slug)}/backfill`,
          {},
          config,
        );

        if (config.json) {
          printJson(data);
        } else {
          printSuccess(
            `Backfill complete: ${data.classified} posts classified, ` +
              `${data.matched} matched, ${data.elapsed_ms}ms`,
          );
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Backfill All ──
  topics
    .command('backfill-all')
    .description('Re-classify posts for all active topics')
    .action(async () => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiGet<AdminTopic[]>('/api/admin/topics', config);
        const active = data.filter((t) => t.isActive);

        console.log(`Backfilling ${active.length} active topics...`);

        let totalClassified = 0;
        let totalMatched = 0;

        for (const topic of active) {
          process.stdout.write(`  ${topic.name}... `);
          const result = await apiPost<{ classified: number; matched: number; elapsed_ms: number }>(
            `/api/admin/topics/${encodeURIComponent(topic.slug)}/backfill`,
            {},
            config,
          );
          totalClassified = Math.max(totalClassified, result.classified);
          totalMatched += result.matched;
          console.log(`${result.matched} matched (${result.elapsed_ms}ms)`);
        }

        printSuccess(
          `All backfills complete: ${totalClassified} posts, ${totalMatched} total topic matches`,
        );
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });

  // ── Classify ──
  topics
    .command('classify')
    .description('Test-classify text against the topic taxonomy')
    .argument('<text>', 'Text to classify')
    .action(async (text: string) => {
      try {
        const config = resolveConfig(program.opts());
        const data = await apiPost<{
          vector: Record<string, number>;
          matchedTopics: string[];
          tokenCount: number;
        }>('/api/admin/topics/classify', { text }, config);

        if (config.json) {
          printJson(data);
        } else {
          console.log(`Tokens: ${data.tokenCount}`);
          if (data.matchedTopics.length === 0) {
            console.log('No topics matched.');
          } else {
            console.log(`Matched ${data.matchedTopics.length} topics:`);
            const sorted = Object.entries(data.vector).sort((a, b) => b[1] - a[1]);
            for (const [slug, score] of sorted) {
              console.log(`  ${slug}: ${score.toFixed(2)}`);
            }
          }
        }
      } catch (err) {
        printError((err as Error).message);
        process.exitCode = 1;
      }
    });
}
