const pantalla1 =document.querySelector(".displaytotal");
const botones= document.querySelectorAll("button");
const pantalla2 =document.querySelector(".segunda");
const pantalla3 =document.querySelector(".mr");


botones.forEach(btn=>{
    btn.addEventListener("click", ()=>{
       const presionado = btn.textContent;
        

       if (btn.id==="BOTON%"){
         pantalla1.textContent+="/100*"
         return

       }
       if (btn.id==="BOTON√"){
        var raiz=pantalla1.textContent=Math.sqrt(pantalla1.textContent);
         
         return

       }

        if (btn.id==="BOTONmr"&& pantalla2.textContent==0 )  {
        return
          }
         
         

       if (btn.id==="BOTONmr") {
         pantalla3.textContent=pantalla2.textContent;
     
         return
       }
       if (btn.id==="BOTONmrl") {
         pantalla3.textContent="0";
     
         return
       }

       if (btn.id==="BOTON/") {
         pantalla1.textContent+="/"
     
         return  
       }
      
        if (btn.id==="BOTONmr") {
         pantalla3.textContent=pantalla2.textContent
         return
         
       }
       
       


       if (btn.id==="BOTONX") {
         pantalla1.textContent+="*"
         return
        
         
       }
       
       
       if(btn.id==="BOTONC"){
       
        pantalla1.textContent="0"
        return;
       }
       if(btn.id==="BOTONCE"){
        
        pantalla1.textContent="0"
        pantalla2.textContent="0"
        return;
       }


       if(btn.id==="BOTONDEL"){
        if(pantalla1.textContent.length===1 || pantalla2.textContent === "ERROR!!!"){
            pantalla1.textContent= "0";
        }else{
            pantalla1.textContent=pantalla1.textContent.slice(0, -1);
        }
        return;
       }
       if(btn.id==="BOTONigual"){
        try{
              pantalla2.textContent=eval(pantalla1.textContent);
        }catch{
              pantalla2.textContent="ERROR!!!"
        }
        return; 


       }

        if (btn.id==="BOTONmrp" && pantalla1.textContent ==="0"){
          pantalla1.textContent=pantalla3.textContent;
        }
        else if(btn.id==="BOTONmrp" && pantalla1.textContent !=="0"){
             pantalla1.textContent+= pantalla3.textContent;
        }
        
        
        else if (pantalla1.textContent ==="0"|| pantalla1.textContent ==="00"|| pantalla2.textContent ==="ERROR!!!") {
        
        pantalla1.textContent=presionado;
       }
         
       else{
          pantalla1.textContent+= presionado;
       }
      
    })
})
