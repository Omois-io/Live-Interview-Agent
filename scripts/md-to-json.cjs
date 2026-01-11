const fs = require('fs');
const path = require('path');

const INPUT_DIR = path.join(__dirname, '../Interview_questions_answers');
const OUTPUT_FILE = path.join(__dirname, '../questions.json');

function detectCategory(title, filename) {
  const text = (title + ' ' + filename).toLowerCase();
  if (text.includes('ethic')) return 'Ethics';
  if (text.includes('leadership')) return 'Leadership';
  if (text.includes('teamwork') || text.includes('team')) return 'Teamwork';
  if (text.includes('challenge') || text.includes('healthcare')) return 'Healthcare';
  return 'Personal';
}

function parseMarkdownFile(filePath) {
  const content = fs.readFileSync(filePath, 'utf-8');
  const filename = path.basename(filePath);

  // Extract title (first # line)
  const titleMatch = content.match(/^#\s+(.+)$/m);
  const title = titleMatch ? titleMatch[1] : '';

  // Extract question (text after ## Question until ## Answer)
  const questionMatch = content.match(/##\s*Question\s*\n([\s\S]*?)(?=##\s*Answer|$)/i);
  const question = questionMatch ? questionMatch[1].trim() : '';

  // Extract answer (text after ## Answer until --- or end)
  const answerMatch = content.match(/##\s*Answer\s*\n([\s\S]*?)(?=\n---|\n\*Target|$)/i);
  let answer = answerMatch ? answerMatch[1].trim() : '';

  // Clean up answer - remove trailing metadata
  answer = answer.replace(/\n\*Target length:.*$/i, '').trim();

  return {
    id: filename,
    category: detectCategory(title, filename),
    question,
    answer
  };
}

function main() {
  // Read all .md files
  const files = fs.readdirSync(INPUT_DIR)
    .filter(f => f.endsWith('.md'))
    .map(f => path.join(INPUT_DIR, f));

  console.log(`Found ${files.length} markdown files`);

  // Parse each file
  const questions = files.map(file => {
    const qa = parseMarkdownFile(file);
    console.log(`  - ${qa.id}: "${qa.question.substring(0, 50)}..."`);
    return qa;
  });

  // Write to JSON
  fs.writeFileSync(OUTPUT_FILE, JSON.stringify(questions, null, 2));
  console.log(`\nWritten ${questions.length} questions to ${OUTPUT_FILE}`);
}

main();
