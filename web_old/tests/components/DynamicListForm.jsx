import { createForm } from "@opentf/web-form";

export default function DynamicListForm() {
  const form = createForm({
    initialValues: { skills: ["JavaScript", "HTML"] }
  });

  return (
    <div>
      {form.values.skills.map((skill, index) => (
        <div data-testid={`row-${index}`}>
          <input 
            {...form.register(`skills.${index}`)} 
            data-testid={`input-${index}`}
          />
        </div>
      ))}
    </div>
  );
}
