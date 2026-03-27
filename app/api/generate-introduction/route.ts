/**
 * AI Introduction generation API route
 * Server-side only
 */

import { NextRequest, NextResponse } from 'next/server';
import {
  generateIntroduction,
  paraphraseCurrentState,
  paraphraseProjectSolution,
  getIntroductionSourceFilesBySection,
} from '@/lib/introductionGenerator';
import { extractVerbatimSections, cleanVerbatimSection, buildFinalIntroduction } from '@/lib/verbatimSections';

export async function POST(request: NextRequest) {
  try {
    const body = await request.json();
    const { sourceText } = body as { sourceText?: string };
    if (!sourceText || typeof sourceText !== 'string') {
      return NextResponse.json(
        { error: 'Изходният текст е задължителен' },
        { status: 400 }
      );
    }

    const { currentState, projectSolution, currentStateSource, projectSolutionSource } =
      extractVerbatimSections(sourceText);

    // Per-section source files based on what each document type contributes
    const { section1, section2, section3 } = getIntroductionSourceFilesBySection(sourceText);

    const [introduction, paraphrasedState, paraphrasedSolution] = await Promise.all([
      generateIntroduction(sourceText),
      currentState
        ? paraphraseCurrentState(cleanVerbatimSection(currentState))
        : Promise.resolve(null),
      projectSolution
        ? paraphraseProjectSolution(cleanVerbatimSection(projectSolution))
        : Promise.resolve(null),
    ]);

    const result = buildFinalIntroduction(introduction, paraphrasedState, paraphrasedSolution, {
      section1,
      section2,
      section3,
      currentStateSource,
      projectSolutionSource,
    });

    return NextResponse.json({ introduction: result });
  } catch (err) {
    const message =
      err instanceof Error ? err.message : 'Грешка при генериране на увода';
    return NextResponse.json({ error: message }, { status: 500 });
  }
}
