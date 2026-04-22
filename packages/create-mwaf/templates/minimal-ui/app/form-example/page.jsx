import { createForm } from "@opentf/mwaf-form";

export default function FormExample() {
  const form = createForm({
    initialValues: { name: "", email: "" },
    validate: (values) => {
      const errors = {};
      if (!values.name) errors.name = "Name is required";
      if (!values.email.includes("@")) errors.email = "Invalid email";
      return errors;
    }
  });

  const onSubmit = (values) => {
    alert("Form Submitted: " + JSON.stringify(values, null, 2));
  };

  return (
    <div className="max-w-md mx-auto space-y-6">
      <h2 className="text-2xl font-bold">Reactive Form Example</h2>
      
      <form onsubmit={form.handleSubmit(onSubmit)} className="space-y-4">
        <div>
          <label className="block text-sm font-medium text-slate-400">Name</label>
          <input 
            {...form.register("name")}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          {() => form.errors.value.name && (
            <span className="text-red-400 text-sm">{form.errors.value.name}</span>
          )}
        </div>

        <div>
          <label className="block text-sm font-medium text-slate-400">Email</label>
          <input 
            {...form.register("email")}
            className="w-full bg-slate-800 border border-slate-700 rounded-lg p-2 focus:ring-2 focus:ring-indigo-500 outline-none"
          />
          {() => form.errors.value.email && (
            <span className="text-red-400 text-sm">{form.errors.value.email}</span>
          )}
        </div>

        <button 
          type="submit"
          className="w-full bg-indigo-600 hover:bg-indigo-500 py-2 rounded-lg font-bold transition-colors"
        >
          Submit
        </button>
      </form>
    </div>
  );
}
