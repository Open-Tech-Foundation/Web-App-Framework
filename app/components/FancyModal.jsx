export default function FancyModal(props) {
  let isOpen = $state(false);
  const modalContent = $ref();

  const open = () => {
    isOpen = true;
    // We can even animate or focus things inside when opened
    setTimeout(() => {
      modalContent.style.opacity = "1";
      modalContent.style.transform = "scale(1)";
    }, 10);
  };

  const close = () => {
    modalContent.style.opacity = "0";
    modalContent.style.transform = "scale(0.95)";
    setTimeout(() => {
      isOpen = false;
    }, 200);
  };

  $expose({ open, close });

  return (
    <div 
      style={{ 
        display: isOpen ? 'flex' : 'none',
        position: 'fixed',
        inset: '0',
        backgroundColor: 'rgba(0,0,0,0.5)',
        backdropFilter: 'blur(4px)',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: '1000'
      }}
      onclick={(e) => e.target === e.currentTarget && close()}
    >
      <div 
        ref={modalContent}
        style={{ 
          backgroundColor: '#1e293b',
          padding: '2rem',
          borderRadius: '1rem',
          border: '1px solid #334155',
          boxShadow: '0 25px 50px -12px rgba(0,0,0,0.5)',
          maxWidth: '400px',
          width: '90%',
          opacity: '0',
          transform: 'scale(0.95)',
          transition: 'all 0.2s ease-out',
          color: 'white'
        }}
      >
        <h2 className="text-xl font-bold mb-4">{props.title || "Modal Title"}</h2>
        <div className="text-slate-400 mb-6">
          {props.children}
        </div>
        <button 
          onclick={close}
          className="w-full py-2 bg-indigo-600 hover:bg-indigo-500 rounded-lg font-bold transition-colors"
        >
          Got it!
        </button>
      </div>
    </div>
  );
}
