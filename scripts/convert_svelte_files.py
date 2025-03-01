import os
import shutil
from pathlib import Path

def generate_tree(startpath: str, output_file: str):
    """Generate a text file containing the directory tree structure."""
    with open(output_file, 'w', encoding='utf-8') as f:
        f.write('src/\n')  # Write root manually since we're starting from src
        for root, dirs, files in os.walk(startpath):
            # Skip the text_files directory
            if 'text_files' in root:
                continue
                
            # Calculate level based on src/ as root
            rel_path = os.path.relpath(root, startpath)
            level = rel_path.count(os.sep) + (1 if rel_path != '.' else 0)
            
            # Don't write 'src' again since we wrote it manually
            if rel_path != '.':
                indent = '│   ' * (level - 1)
                f.write(f'{indent}└── {os.path.basename(root)}/\n')
            
            # Write files
            subindent = '│   ' * level
            # Sort files for consistent output
            for file in sorted(files):
                f.write(f'{subindent}└── {file}\n')

def create_text_files():
    """Create text files of all source files and generate directory tree."""
    # Ensure we're working with the src directory
    src_dir = Path('src')
    if not src_dir.exists():
        raise FileNotFoundError("src directory not found! Please run this script from the project root.")
    
    # Create text_files directory if it doesn't exist
    output_dir = Path('text_files')
    output_dir.mkdir(exist_ok=True)
    
    # Create a list to store all processed files for the tree
    processed_files = []
    
    # Walk through src directory and subdirectories
    for root, dirs, files in os.walk(src_dir):
        # Skip the text_files directory itself and any hidden directories
        if 'text_files' in root or '/.' in root or '\\.' in root:
            continue
            
        # Process each file
        for file in files:
            # Skip hidden files and compiled files
            if not file.endswith(('.svelte')):
                continue
                
            # Get the full path of the source file
            source_path = Path(root) / file
            
            # Create corresponding path in text_files directory
            # Convert the directory structure to a flat naming scheme
            relative_path = Path(root).relative_to(src_dir)
            if relative_path == Path('.'):
                new_filename = f"{Path(file).stem}.txt"
            else:
                # Include directory structure in filename
                new_filename = f"{relative_path}_{Path(file).stem}".replace('/', '_').replace('\\', '_') + '.txt'
                
            output_path = output_dir / new_filename
            
            # Copy the contents
            try:
                with open(source_path, 'r', encoding='utf-8') as source:
                    content = source.read()
                with open(output_path, 'w', encoding='utf-8') as target:
                    target.write(content)
                print(f"Created {output_path}")
                processed_files.append(str(source_path))
            except Exception as e:
                print(f"Error processing {source_path}: {str(e)}")
    
    # Generate the tree structure
    tree_file = output_dir / 'src_directory_tree.txt'
    generate_tree(src_dir, str(tree_file))
    print(f"\nDirectory tree has been saved to {tree_file}")
    
    # Print summary
    print(f"\nSummary:")
    print(f"Total files processed: {len(processed_files)}")
    print(f"Output directory: {output_dir.absolute()}")

def main():
    try:
        print("Starting file processing from src/ directory...")
        create_text_files()
        print("\nProcessing complete!")
    except FileNotFoundError as e:
        print(f"Error: {e}")
        exit(1)
    except Exception as e:
        print(f"An unexpected error occurred: {e}")
        exit(1)

if __name__ == "__main__":
    main()