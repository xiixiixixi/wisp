// Standalone probe: set/read Finder tags on a real file so the binary
// plist bytes can be verified externally (xattr, python plistlib, mdls).
use wisp::storage::{read_tag_strings, strings_to_tags, tags_to_strings, write_tag_strings};

fn main() {
    let args: Vec<String> = std::env::args().collect();
    let path = args[1].clone();
    if args.len() == 2 {
        for t in strings_to_tags(&read_tag_strings(&path).unwrap()) {
            println!("{} {}", t.name, t.color);
        }
    } else {
        let mut tags = Vec::new();
        let mut i = 2;
        while i + 1 < args.len() {
            tags.push(wisp::storage::FileTag {
                name: args[i].clone(),
                color: args[i + 1].clone(),
            });
            i += 2;
        }
        write_tag_strings(&path, &tags_to_strings(&tags)).unwrap();
        println!("written {} tags", tags.len());
    }
}
