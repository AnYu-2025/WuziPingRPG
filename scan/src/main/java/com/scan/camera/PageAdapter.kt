package com.scan.camera

import android.view.LayoutInflater
import android.view.ViewGroup
import androidx.recyclerview.widget.RecyclerView
import com.scan.camera.databinding.ItemPageThumbBinding

class PageAdapter(
    private val pages: MutableList<Page>,
    private val onClick: (Int) -> Unit
) : RecyclerView.Adapter<PageAdapter.Holder>() {

    class Holder(val binding: ItemPageThumbBinding) : RecyclerView.ViewHolder(binding.root)

    override fun onCreateViewHolder(parent: ViewGroup, viewType: Int): Holder {
        val binding = ItemPageThumbBinding.inflate(
            LayoutInflater.from(parent.context), parent, false
        )
        return Holder(binding)
    }

    override fun getItemCount() = pages.size

    override fun onBindViewHolder(holder: Holder, position: Int) {
        val page = pages[position]
        holder.binding.thumbImage.setImageBitmap(page.thumbnail)
        holder.binding.pageNumber.text = java.lang.String.valueOf(position + 1)
        holder.binding.root.setOnClickListener {
            // 删除页面后已绑定的 holder 持有过期 position，必须取实时位置
            val pos = holder.bindingAdapterPosition
            if (pos != RecyclerView.NO_POSITION) onClick(pos)
        }
    }
}
