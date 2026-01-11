#!/usr/bin/env python3
"""
Gemini-powered Q&A Extractor
Extracts interview questions and answers from various file formats.

Supported file types: .docx, .pdf, .txt, .xlsx, .md
"""

import os
import sys
import json
import argparse
from pathlib import Path
from typing import List, Literal
from pydantic import BaseModel, Field

# Supported file types
SUPPORTED_TYPES = ['.docx', '.pdf', '.txt', '.xlsx', '.md']

# Available models with their configs
MODELS = {
    'gemini-2.0-flash': {
        'id': 'gemini-2.0-flash',
        'temperature': 0.7,
    },
    'gemini-3-flash-preview': {
        'id': 'gemini-3-pro-preview',  # Actual model ID
        'temperature': 1.0,
    },
}

# File readers
def read_txt(path: Path) -> str:
    return path.read_text(encoding='utf-8')

def read_md(path: Path) -> str:
    return path.read_text(encoding='utf-8')

def read_docx(path: Path) -> str:
    try:
        from docx import Document
        doc = Document(path)
        return '\n\n'.join(p.text for p in doc.paragraphs)
    except ImportError:
        print("Install python-docx: pip install python-docx")
        sys.exit(1)

def read_pdf(path: Path) -> str:
    try:
        import fitz  # PyMuPDF
        doc = fitz.open(path)
        text = []
        for page in doc:
            text.append(page.get_text())
        return '\n\n'.join(text)
    except ImportError:
        print("Install PyMuPDF: pip install pymupdf")
        sys.exit(1)

def read_xlsx(path: Path) -> str:
    try:
        import openpyxl
        wb = openpyxl.load_workbook(path)
        text = []
        for sheet in wb.worksheets:
            for row in sheet.iter_rows(values_only=True):
                row_text = '\t'.join(str(c) if c else '' for c in row)
                if row_text.strip():
                    text.append(row_text)
        return '\n'.join(text)
    except ImportError:
        print("Install openpyxl: pip install openpyxl")
        sys.exit(1)

READERS = {
    '.txt': read_txt,
    '.md': read_md,
    '.docx': read_docx,
    '.pdf': read_pdf,
    '.xlsx': read_xlsx,
}

# Pydantic Schema
CategoryType = Literal["Personal", "Ethics", "Leadership", "Teamwork", "Healthcare", "Technical", "Other"]

class InterviewQA(BaseModel):
    """A single interview question-answer pair."""
    category: CategoryType = Field(description="Category of the question")
    question: str = Field(description="The interview question")
    answer: str = Field(description="The prepared answer - EXACT text from user")

class ExtractionResult(BaseModel):
    """Result of Q&A extraction from a document."""
    questions: List[InterviewQA] = Field(description="List of extracted Q&A pairs")

# Gemini API
def extract_with_gemini(content: str, api_key: str, model_key: str) -> List[dict]:
    """Use Gemini to extract Q&A pairs from content."""
    try:
        import google.generativeai as genai
    except ImportError:
        print("Install google-generativeai: pip install google-generativeai")
        sys.exit(1)

    genai.configure(api_key=api_key)

    # Load prompts with Jinja2
    try:
        from jinja2 import Template
    except ImportError:
        print("Install jinja2: pip install jinja2")
        sys.exit(1)

    prompts_dir = Path(__file__).parent / 'prompts'
    system_prompt = (prompts_dir / 'system.txt').read_text()
    user_template = Template((prompts_dir / 'user.txt').read_text())
    user_prompt = user_template.render(content=content)

    # Get model config
    model_config = MODELS.get(model_key, MODELS['gemini-2.0-flash'])

    model = genai.GenerativeModel(
        model_name=model_config['id'],
        system_instruction=system_prompt,
        generation_config={
            'temperature': model_config['temperature'],
            'response_mime_type': 'application/json',
            'response_schema': {
                'type': 'array',
                'items': {
                    'type': 'object',
                    'properties': {
                        'category': {'type': 'string'},
                        'question': {'type': 'string'},
                        'answer': {'type': 'string'},
                    },
                    'required': ['category', 'question', 'answer']
                }
            }
        }
    )

    response = model.generate_content(user_prompt)
    return json.loads(response.text)

def process_file(file_path: Path, api_key: str, model: str) -> List[dict]:
    """Process a single file and extract Q&A pairs."""
    suffix = file_path.suffix.lower()

    if suffix not in READERS:
        print(f"Unsupported file type: {suffix}")
        print(f"Supported types: {', '.join(SUPPORTED_TYPES)}")
        return []

    print(f"Reading {file_path.name}...")
    content = READERS[suffix](file_path)

    if not content.strip():
        print(f"  No content found in {file_path.name}")
        return []

    print(f"  Extracting Q&A with {model}...")
    qa_pairs = extract_with_gemini(content, api_key, model)

    # Add file-based ID
    for i, qa in enumerate(qa_pairs):
        qa['id'] = f"{file_path.stem}_{i+1}.md"

    print(f"  Found {len(qa_pairs)} Q&A pairs")
    return qa_pairs

def main():
    print("=" * 50)
    print("Upload with AI - Q&A Extractor")
    print("=" * 50)
    print(f"Supported file types: {', '.join(SUPPORTED_TYPES)}")
    print()

    parser = argparse.ArgumentParser(
        description='Extract Q&A from documents using Gemini AI',
        epilog=f'Supported file types: {", ".join(SUPPORTED_TYPES)}'
    )
    parser.add_argument('input', nargs='+', help='Input file(s) or directory')
    parser.add_argument('-o', '--output', default='questions.json', help='Output JSON file')
    parser.add_argument('-m', '--model', choices=list(MODELS.keys()), default='gemini-2.0-flash',
                        help='Model to use (default: gemini-2.0-flash)')
    parser.add_argument('--append', action='store_true', help='Append to existing output file')
    args = parser.parse_args()

    print(f"Using model: {args.model} (temp={MODELS[args.model]['temperature']})")
    print()

    # Get API key
    api_key = os.environ.get('GEMINI_API_KEY')
    if not api_key:
        api_key = input("Enter your Gemini API key: ").strip()

    if not api_key:
        print("Error: No API key provided")
        sys.exit(1)

    # Collect files
    files = []
    for path_str in args.input:
        path = Path(path_str)
        if path.is_dir():
            for ext in READERS.keys():
                files.extend(path.glob(f'*{ext}'))
        elif path.exists():
            files.append(path)
        else:
            print(f"Warning: {path} not found")

    if not files:
        print("No files to process")
        print(f"Supported types: {', '.join(SUPPORTED_TYPES)}")
        sys.exit(1)

    print(f"Processing {len(files)} file(s)...")
    print()

    # Extract Q&A from each file
    all_qa = []
    for file_path in files:
        qa_pairs = process_file(file_path, api_key, args.model)
        all_qa.extend(qa_pairs)

    # Handle append mode
    output_path = Path(args.output)
    if args.append and output_path.exists():
        existing = json.loads(output_path.read_text())
        all_qa = existing + all_qa

    # Write output
    output_path.write_text(json.dumps(all_qa, indent=2))
    print()
    print(f"Written {len(all_qa)} Q&A pairs to {output_path}")

if __name__ == '__main__':
    main()
